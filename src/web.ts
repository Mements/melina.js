import { build as bunBuild, type BuildConfig, type BunFile } from "bun";
import path from "path";
import { randomUUID } from "crypto";
import { existsSync } from "fs";

import autoprefixer from "autoprefixer";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import fs from 'fs';

import { measure } from "@ments/utils";

type HandlerResponse = Response | AsyncGenerator<string, void, unknown> | string | object;

type Handler = (req: Request, measure: (fn: () => any, name: string, options?: any) => any) => HandlerResponse | Promise<HandlerResponse>;

interface ImportConfig {
  name: string;
  version?: string;
  deps?: string[];
  external?: boolean | string[];
  markAllExternal?: boolean;
  baseName?: string;
  subpath?: string;
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
  if (pkgJson === null) {
    return { imports: {} };
  }
  if (!packageJson) {
    try {
      const packagePath = path.resolve(process.cwd(), 'package.json');
      console.log('packagePath', packagePath);
      packageJson = (await import(packagePath, { assert: { type: 'json' } })).default;
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

/**
 * ## getContentType
 * Returns the appropriate MIME type for a given file extension.
 * This has been expanded to include common font types and other static assets.
 */
function getContentType(ext: string): string {
  switch (ext.toLowerCase()) {
    // Images
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    case '.ico':
      return 'image/x-icon';

    // Fonts
    case '.ttf':
      return 'font/ttf';
    case '.otf':
      return 'font/otf';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    case '.eot':
      return 'application/vnd.ms-fontobject';

    // Styles & Scripts
    case '.css':
      return 'text/css';
    case '.js':
      return 'text/javascript';

    // Data & Documents
    case '.json':
      return 'application/json';
    case '.pdf':
      return 'application/pdf';

    // Audio/Video
    case '.mp3':
      return 'audio/mpeg';
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';

    // Default catch-all
    default:
      return 'application/octet-stream';
  }
}

/**
 * Build JavaScript/TypeScript files using Bun's bundler
 * @param filePath Path to the script file
 * @returns URL path to the built asset
 */
export async function buildScript(filePath: string): Promise<string> {
  if (!filePath) {
    throw new Error('File path is required');
  }

  const absolutePath = path.resolve(process.cwd(), filePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Script not found: ${filePath}`);
  }

  // Return cached result in production if available
  if (!isDev && buildCache[filePath]) {
    return buildCache[filePath].outputPath;
  }

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
    outdir: undefined, // Build to memory
    minify: !isDev,
    target: "browser",
    sourcemap: isDev ? "linked" : "none",
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

  let result;
  try {
    result = await bunBuild(buildConfig);
  } catch (error) {
    // Fallback to Bun.$`bun build` for better error output
    console.error(`bunBuild failed, trying fallback: ${error}`);
    try {
      await Bun.$`bun build ${absolutePath} --outdir /tmp --target browser --sourcemap=${isDev ? "linked" : "none"}`;
    } catch (fallbackError) {
      throw new Error(`Build failed for ${filePath}: ${fallbackError}`);
    }
    throw new Error(`Build failed for ${filePath}: ${error}`);
  }
  
  const mainOutput = result.outputs.find(o => o.kind === 'entry-point');
  if (!mainOutput) {
    throw new Error(`No entry-point output found for ${filePath}`);
  }

  // Process all build outputs (e.g., JS file and its sourcemap)
  for (const output of result.outputs) {
    const content = await output.arrayBuffer();
    const outputPath = `/${path.basename(output.path)}`;
    const contentType = output.type || getContentType(path.extname(output.path));
    builtAssets[outputPath] = { content, contentType };
  }

  const outputPath = `/${path.basename(mainOutput.path)}`;
  buildCache[filePath] = { outputPath, content: await mainOutput.arrayBuffer() };

  return outputPath;
}

/**
 * Build CSS files with PostCSS processing
 * @param filePath Path to the CSS file
 * @returns URL path to the built asset
 */
export async function buildStyle(filePath: string): Promise<string> {
  if (!filePath) {
    throw new Error('File path is required');
  }

  const absolutePath = path.resolve(process.cwd(), filePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Style not found: ${filePath}`);
  }

  // Return cached result in production if available
  if (!isDev && buildCache[filePath]) {
    return buildCache[filePath].outputPath;
  }

  const ext = path.extname(absolutePath).toLowerCase();
  const baseName = path.basename(absolutePath, ext);

  const cssContent = await Bun.file(absolutePath).text();
  const result = await postcss([autoprefixer, tailwind]).process(cssContent, {
    from: absolutePath,
    to: 'style.css', // Dummy 'to' path for source map generation
    map: isDev ? { inline: false } : false,
  });

  if (!result.css) {
    throw new Error(`PostCSS processing returned empty CSS for ${absolutePath}`);
  }

  let finalCss = result.css;
  const hash = new Bun.CryptoHasher("sha256").update(finalCss).digest('hex').slice(0, 8);
  const outputPath = `/${baseName}-${hash}.css`;
  const contentType = 'text/css';

  // Handle and serve source map in development
  if (isDev && result.map) {
    const sourceMapPath = `${outputPath}.map`;
    const sourceMapContent = result.map.toString();
    builtAssets[sourceMapPath] = { content: new TextEncoder().encode(sourceMapContent), contentType: 'application/json' };
    finalCss += `\n/*# sourceMappingURL=${path.basename(sourceMapPath)} */`;
  }

  const content = new TextEncoder().encode(finalCss);
  buildCache[filePath] = { outputPath, content };
  builtAssets[outputPath] = { content, contentType };
  return outputPath;
}

/**
 * Build static assets (images, fonts, etc.) from BunFile
 * @param file BunFile object
 * @returns URL path to the built asset
 */
export async function buildAsset(file?: BunFile): Promise<string> {
  if (!file) {
    return '';
  }

  // Get the file path from the BunFile object
  const filePath = file.name || '';
  if (!filePath) {
    throw new Error('BunFile object must have a name property');
  }

  // Check if file exists by trying to get its size
  const fileExists = await file.exists();
  if (!fileExists) {
    throw new Error(`Asset not found: ${filePath}`);
  }

  // Return cached result in production if available
  if (!isDev && buildCache[filePath]) {
    return buildCache[filePath].outputPath;
  }

  const ext = path.extname(filePath).toLowerCase();
  const baseName = path.basename(filePath, ext);

  const content = await file.arrayBuffer();
  const hash = new Bun.CryptoHasher("sha256").update(new Uint8Array(content)).digest('hex').slice(0, 8);
  const outputPath = `/${baseName}-${hash}${ext}`;
  const contentType = getContentType(ext);

  buildCache[filePath] = { outputPath, content };
  builtAssets[outputPath] = { content, contentType };
  return outputPath;
}

// Legacy function for backwards compatibility
export async function asset(fileOrPath: BunFile | string): Promise<string> {
  console.warn('asset() is deprecated. Use buildScript(), buildStyle(), or buildAsset() instead.');
  
  if (typeof fileOrPath === 'string') {
    const ext = path.extname(fileOrPath).toLowerCase();
    if (ext === '.css') {
      return buildStyle(fileOrPath);
    } else if (ext === '.js' || ext === '.ts' || ext === '.jsx' || ext === '.tsx') {
      return buildScript(fileOrPath);
    } else {
      // For other files, create a BunFile and use buildAsset
      const file = Bun.file(fileOrPath);
      return buildAsset(file);
    }
  } else {
    // It's a BunFile
    return buildAsset(fileOrPath);
  }
}

export async function serve(handler: Handler, options?: { port?: number }) {
  const isDev = process.env.NODE_ENV !== "production";

  const server = Bun.serve({
    idleTimeout: 0,
    port: options?.port || process.env.BUN_PORT ? parseInt(process.env.BUN_PORT!, 10) : undefined,
    development: isDev,
    async fetch(req) {
      let requestId = req.headers.get("X-Request-ID");
      if (!requestId) {
        requestId = generateRequestId();
        req.headers.set("X-Request-ID", requestId);
      }

      return await measure(
        async (measure) => {
          const url = new URL(req.url);
          const pathname = url.pathname;

          // Check for built assets in memory first
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
            // Create a new headers object to ensure we can modify it
            const headers = new Headers(response.headers);
            headers.set("X-Request-ID", requestId);
            
            // Clone the response with the updated headers
            return new Response(response.body, {
              status: response.status,
              statusText: response.statusText,
              headers: headers
            });
          }

          if (typeof response === 'string') {
            return new Response(response, {
              headers: { "Content-Type": "text/html; charset=utf-8", "X-Request-ID": requestId },
            });
          }

          if (typeof response === 'object' && response != null && response[Symbol.asyncIterator]) {
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
      const errorDetails = error.message;
      const stackTrace = error.stack ?? 'No stack trace available';
      const detailedLogs = JSON.stringify(error, Object.getOwnPropertyNames(error), 2);

      const body = isDev
        ? `<!DOCTYPE html>
            <html>
              <head>
                <title>Server Error</title>
                <style>
                  body { font-family: monospace; padding: 20px; background: #fff1f1; color: #333; }
                  pre { background: #fdfdfd; padding: 15px; border-radius: 4px; border: 1px solid #ddd; overflow-x: auto; }
                  h1 { color: #d92626; }
                </style>
              </head>
              <body>
                <h1>Server Error</h1>
                <h3>Error:</h3>
                <pre>${errorDetails}</pre>
                <h3>Stack Trace:</h3>
                <pre>${stackTrace}</pre>
                <h3>Full Error Object:</h3>
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

// Clear caches for testing
export function clearCaches() {
  Object.keys(buildCache).forEach(key => delete buildCache[key]);
  Object.keys(builtAssets).forEach(key => delete builtAssets[key]);
}
