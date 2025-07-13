import { build as bunBuild, type BuildConfig } from "bun";
import path from "path";
import { randomUUID } from "crypto";
import { existsSync } from "fs";

import autoprefixer from "autoprefixer"
import postcss from "postcss"
import tailwind from "@tailwindcss/postcss"
import fs from 'fs'

import { measure } from "@ments/utils";

type HandlerResponse = Response | AsyncGenerator<string, void, unknown> | string | object;

type Handler = (req: Request) => HandlerResponse | Promise<HandlerResponse>;

interface ImportConfig {
  name: string;
  version?: string;
  deps?: string[];
  external?: boolean | string[];
  markAllExternal?: boolean;
}

type ImportMap = { imports: Record<string, string> };

// Generate unique request ID (still used for top-level context)
function generateRequestId(): string {
  return Math.random().toString(36).substring(2, 10);
}

const isDev = process.env.NODE_ENV !== "production";

export async function imports(
  subpaths: string[] = [],
  pkgJson: any = null,
  lockFile: any = null,
): Promise<ImportMap> {
  let packageJson: any = pkgJson;
  if (!packageJson) {
    try {
      packageJson = (await import(path.resolve(process.cwd(), 'package.json'), { assert: { type: 'json' } })).default;
    } catch (e) {
      console.error("Failed to load package.json:", e);
      return { imports: {} };
    }
  }

  let bunLock: any = lockFile;
  if (!bunLock) {
    try {
      bunLock = (await import(path.resolve(process.cwd(), 'bun.lock'), { assert: { type: 'json' } })).default;
    } catch (e) {
      console.warn("No bun.lock file found, proceeding without it.");
    }
  }

  const importMap: ImportMap = { imports: {} };
  const versionMap: Record<string, string> = {};
  const dependencies = {
    ...(packageJson.dependencies || {}),
  };

  const getCleanVersion = (version: string): string => version.replace(/^[~^]/, '');

  const imports: Record<string, ImportConfig> = {};

  // Process top-level dependencies
  Object.entries(dependencies).forEach(([name, versionSpec]) => {
    if (typeof versionSpec !== 'string') return;

    const cleanVersion = getCleanVersion(versionSpec);
    let peerDeps: string[] = [];

    if (bunLock && bunLock.packages && bunLock.packages[name]) {
      const lockEntry = bunLock.packages[name];
      const metadata = lockEntry[2];

      if (metadata && metadata.peerDependencies) {
        Object.keys(metadata.peerDependencies).forEach(peerName => {
          if (!(metadata.peerDependenciesMeta?.[peerName]?.optional)) {
            if (dependencies[peerName]) {
              peerDeps.push(peerName);
            }
          }
        });
      }
    }

    const nameWithSuffix = `${name}`;
    imports[nameWithSuffix] = {
      name,
      version: cleanVersion,
      ...(peerDeps.length > 0 ? { deps: peerDeps } : {}),
    };
  });

  subpaths.forEach(subpath => {
    const [baseName, ...subpathParts] = subpath.split('/'); // e.g., 'react-dom' and ['client']
    const versionSpec = dependencies[baseName];
    if (!versionSpec) {
      console.warn(`No version found for base package "${baseName}" of subpath "${subpath}". Skipping.`);
      return;
    }

    const cleanVersion = getCleanVersion(versionSpec);
    let peerDeps: string[] = [];

    if (bunLock && bunLock.packages && bunLock.packages[baseName]) {
      const lockEntry = bunLock.packages[baseName];
      const metadata = lockEntry[2];

      if (metadata && metadata.peerDependencies) {
        Object.keys(metadata.peerDependencies).forEach(peerName => {
          if (!(metadata.peerDependenciesMeta?.[peerName]?.optional)) {
            if (dependencies[peerName]) {
              peerDeps.push(peerName);
            }
          }
        });
      }
    }

    imports[subpath] = {
      name: subpath,
      version: cleanVersion,
      ...(peerDeps.length > 0 ? { deps: peerDeps } : {}),
      baseName,
      subpath: subpathParts.join('/'),
    };
  });

  await measure(async (measure) => {
    // First pass: Collect all versions specified for base packages
    Object.entries(imports).forEach(([_, imp]) => {
      const baseName = imp.baseName || (imp.name.startsWith("@") ? imp.name.split("/").slice(0, 2).join("/") : imp.name.split("/")[0]);
      if (!versionMap[baseName] || imp.version) {
        versionMap[baseName] = imp.version ?? "latest";
      }
    });

    // Second pass: Build the import map URLs
    Object.entries(imports).forEach(([key, imp]) => {
      let url: string;
      const baseName = imp.baseName || (imp.name.startsWith("@") ? imp.name.split("/").slice(0, 2).join("/") : imp.name.split("/")[0]);
      const version = versionMap[baseName] || 'latest';

      const useStarPrefix = imp.markAllExternal === true;
      const starPrefix = useStarPrefix ? '*' : '';

      if (imp.subpath) {
        // For subpaths, construct URL as baseName@version/subpath
        url = `https://esm.sh/${starPrefix}${baseName}@${version}/${imp.subpath}`;
      } else {
        // For top-level packages
        url = `https://esm.sh/${starPrefix}${imp.name}@${version}`;
      }

      let queryParts: string[] = [];

      if (imp.external && !useStarPrefix) {
        let externals: string[] = [];
        if (Array.isArray(imp.external)) {
          externals = imp.external;
        } else if (imp.external === true) {
          externals = Object.keys(imports)
            .filter(otherKey => otherKey !== key)
            .map(otherKey => imports[otherKey].name.split('/')[0])
            .filter((value, index, self) => self.indexOf(value) === index);
        }
        if (externals.length > 0) {
          queryParts.push(`external=${externals.join(',')}`);
        }
      }

      if (imp.deps?.length) {
        const depsList = imp.deps
          .map((depName) => {
            const depBaseName = depName.startsWith("@") ? depName.split("/").slice(0, 2).join("/") : depName.split("/")[0];
            const depVersion = versionMap[depBaseName] || 'latest';
            return `${depName}@${depVersion}`;
          })
          .join(",");
        queryParts.push(`deps=${depsList}`);
      }

      if (isDev) queryParts.push("dev");

      let paramsPrefix = '?';
      let paramsSuffix = '';
      if (key.endsWith('/')) {
        paramsPrefix = '&';
        paramsSuffix = '/';
      }

      if (queryParts.length) url += `${paramsPrefix}${queryParts.join("&")}${paramsSuffix}`;

      measure(
        () => {
          importMap.imports[key] = url;
        },
        `Import for ${key} is ${url}`,
        { level: 1 }
      );
    });
  }, "Generate Import Map");

  return importMap;
}

const buildCache: Record<string, { outputPath: string; content: ArrayBuffer }> = {};
const builtAssets: Record<string, { content: ArrayBuffer; contentType: string }> = {};

function getContentType(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.bmp':
      return 'image/bmp';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];

export async function asset(filePath: string = ''): Promise<string> {
  const isDev = process.env.NODE_ENV !== "production";
  if (!filePath) {
    return '';
  }

  const absolutePath = path.resolve(process.cwd(), filePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Asset not found: ${filePath}`);
  }

  // Return cached result in production if available
  if (!isDev && buildCache[filePath]) {
    return buildCache[filePath].outputPath;
  }

  const ext = path.extname(absolutePath).toLowerCase();
  const isImage = imageExtensions.includes(ext);

  if (isImage) {
    // Handle image files directly
    const file = Bun.file(absolutePath);
    const content = await file.arrayBuffer();
    const hash = new Bun.CryptoHasher("sha256").update(new Uint8Array(content)).digest('hex').slice(0, 8);
    const baseName = path.basename(absolutePath, ext);
    const outputPath = `/${baseName}-${hash}${ext}`;
    const contentType = getContentType(ext);

    // Store in cache and assets
    buildCache[filePath] = { outputPath, content };
    builtAssets[outputPath] = { content, contentType };
    return outputPath;
  } else if (ext == '.css') {
    // console.log("absolutePath", absolutePath)
    return new Promise((resolve, reject) => {
      fs.readFile(absolutePath, (err, css) => {
        if (err) {
          return reject('cant find style ' + absolutePath);
        }
        // console.log("css", css)
        postcss([autoprefixer, tailwind])
          .process(css, { from: absolutePath })
          .then(result => {
            if (!result.css) {
              return reject(`empty processed style ` + absolutePath);
            }
            const outputPath = `/style.css`; // should be from baseName to support multiple style files
            const content = result.css; // also we need result.map.toString() for style.css.map
            const contentType = 'text/css';

            buildCache[filePath] = { outputPath, content };
            builtAssets[outputPath] = { content, contentType };
            resolve(outputPath);
          }).catch(err => {
            reject('cant process file ' + absolutePath);
          });
      })
    });
  } else {
    // Proceed with build process for non-image files
    let packageJson: any;
    try {
      packageJson = (await import(path.resolve(process.cwd(), 'package.json'), { assert: { type: 'json' } })).default;
    } catch (e) {
      throw new Error("package.json not found");
    }

    const dependencies = { ...(packageJson.dependencies || {}) };
    const external = Object.keys(dependencies);

    const buildConfig: BuildConfig = {
      entrypoints: [absolutePath],
      outdir: undefined,
      minify: !isDev,
      target: "browser",
      sourcemap: isDev ? "linked" : undefined,
      external,
      define: {
        "process.env.NODE_ENV": JSON.stringify(isDev ? "development" : "production"),
      },
      naming: {
        entry: "[name]-[hash].[ext]",
        chunk: "[name]-[hash].[ext]",
        asset: "[name]-[hash].[ext]",
      },
    };

    const result = await bunBuild(buildConfig);
    if (!result.success || !result.outputs.length) {
      throw new Error(`Build failed for ${filePath}: ${result.logs.join('\n')}`);
    }

    const output = result.outputs.length > 1 ? result.outputs.find(o => o.kind === 'entry-point') : result.outputs[0];
    if (!output) {
      throw new Error(`No output for ${filePath}`);
    }

    const content = await output.arrayBuffer();
    const outputPath = `/${path.basename(output.path).replace(/\\/g, '/')}`;
    const contentType = output.type ? output.type : output.path.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';

    buildCache[filePath] = { outputPath, content };
    builtAssets[outputPath] = { content, contentType };
    return outputPath;
  }
}

export async function serve(handler: Handler) {
  const isDev = process.env.NODE_ENV !== "production";

  const server = Bun.serve({
    idleTimeout: 0,
    port: process.env.BUN_PORT ? parseInt(process.env.BUN_PORT, 10) : undefined,
    development: isDev ? {
      hmr: false,
      console: true,
    } : false,
    async fetch(req) {
      // we persist the same request id across multiple requests during the same page refresh: first its     
      let requestId;
      if (req.headers.has("X-Request-ID")) {
        requestId = req.headers.get("X-Request-ID");
      } else {
        requestId = randomUUID().split("-")[0]
        req.headers.set("X-Request-ID", requestId);
      }
      return await measure(
        async (measure) => {
          const url = new URL(req.url);
          const pathname = url.pathname;

          // Check for built assets in memory
          if (builtAssets[pathname]) {
            const { content, contentType } = builtAssets[pathname];
            return new Response(content, {
              headers: {
                "Content-Type": contentType,
                "Cache-Control": isDev ? "no-cache" : "public, max-age=31536000, immutable",
              },
            });
          }

          // Handle request with user handler
          const response = await handler(req, measure);

          if (response instanceof Response) {
            response.headers.set("X-Request-ID", requestId);
            return response;
          }

          if (typeof response === 'string') {
            return new Response(response, {
              headers: { "Content-Type": "text/html; charset=utf-8", "X-Request-ID": requestId },
            });
          }

          if (typeof response === 'object' && response[Symbol.asyncIterator]) {
            const stream = new ReadableStream({
              async start(controller) {
                for await (const chunk of response as AsyncGenerator<string>) {
                  controller.enqueue(new TextEncoder().encode(chunk));
                }
                controller.close();
              },
            });
            return new Response(stream, {
              headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Transfer-Encoding": "chunked",
                "X-Request-ID": requestId
              },
            });
          }

          return new Response(JSON.stringify(response), {
            headers: { "Content-Type": "application/json" },
          });
        },
        `${req.method} ${req.url}`,
        { requestId, idChain: [requestId] }
      );
    },
    error(error: Error) {
      console.error("[Server Error]", error);

      // Ensure we capture all error details
      const errorDetails = error instanceof Error ? error.message : String(error);
      const stackTrace = error instanceof Error ? error.stack : 'No stack trace available';

      // Use JSON.stringify to properly escape and format the error object
      const detailedLogs = JSON.stringify(error, Object.getOwnPropertyNames(error), 2);

      const body = isDev
        ? `<!DOCTYPE html>
           <html>
             <head>
               <title>Server Error</title>
               <style>
                 body { font-family: monospace; padding: 20px; }
                 pre { background: #f5f5f5; padding: 15px; overflow-x: auto; }
                 .error { color: #cc0000; }
               </style>
             </head>
             <body>
               <h1 class="error">Server Error</h1>
               <h3>Error Details:</h3>
               <pre>${errorDetails}</pre>
               <h3>Stack Trace:</h3>
               <pre>${stackTrace}</pre>
               <h3>Debug Information:</h3>
               <pre>${detailedLogs}</pre>
             </body>
           </html>`
        : "Internal Server Error";

      return new Response(body, {
        status: 500,
        headers: {
          "Content-Type": "text/html",
          "Cache-Control": "no-store"
        },
      });
    },
  });

  console.log(`🦊 Melina server running at http://localhost:${server.port}`);
  return server;
}