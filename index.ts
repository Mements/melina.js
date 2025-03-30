import { build, type BuildConfig } from "bun";
import plugin from "bun-plugin-tailwind"; // Assuming this plugin exists and works
import { existsSync } from "fs";
import { rm } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

export type ApiEndpoint = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  body?: any;
  query?: Record<string, string | number | boolean>;
  response: any;
};

export type GetHealthEndpoint = {
  method: 'GET';
  path: '/api/health';
  query?: undefined;
  response: { status: string };
};

export type ApiEndpoints = Record<string, ApiEndpoint>;

type MeasureContext = {
  requestId?: string;
  level?: number;
  parentAction?: string;
};

export type MeasureFn = <T>(
  fn: (measure: MeasureFn) => Promise<T>,
  action: string,
  context?: MeasureContext
) => Promise<T>;

export async function measure<T>(
    fn: (measure: typeof measure) => Promise<T>,
    action: string,
    context: MeasureContext = {}
): Promise<T> {
    const start = performance.now();
    const level = context.level || 0;
    let indent = "=".repeat(level > 0 ? level + 1: 0);
    const requestId = context.requestId;
    let logPrefixStart = requestId ? `[${requestId}] ${indent}>` : `${indent}>`;
    let logPrefixEnd = requestId ? `[${requestId}] ${indent}<` : `${indent}<`;

    try {
        console.log(`${logPrefixStart} ${action}...`);

        const result = await fn((nestedFn, nestedAction) =>
            measure(nestedFn, nestedAction, {
                requestId: requestId,
                level: level + 1,
                parentAction: action
            })
        );

        const duration = performance.now() - start;
        console.log(`${logPrefixEnd} ${action} ✓ ${duration.toFixed(2)}ms`);
        return result;
    } catch (error) {
        const duration = performance.now() - start;
        console.log('=========================== ERROR ===========================');
        console.log(`${logPrefixEnd} ${action} ✗ ${duration.toFixed(2)}ms`);
        if (error instanceof Error) {
             console.error(`Error in action "${action}":`, error.message);
             if(error.stack) console.error(error.stack);
        } else {
             console.error(`Unknown error in action "${action}":`, error);
        }
        console.log('=============================================================');
        throw error;
    }
}

interface PageConfig {
  route: string;
  target: string;
  handler?: (ctx: MiddlewareContext & { requestId: string; measure: MeasureFn }) => Promise<any>;
}

type MiddlewareContext = {
    request: Request;
    method: string;
    path: string;
    query: Record<string, string | number | boolean>;
    body?: any;
    headers: Headers;
};


interface ImportConfig {
  name: string; // e.g., 'react', 'react-dom/client', '@chakra-ui/react'
  version?: string; // e.g., '18.2.0'
  deps?: string[]; // e.g., ['react'] - package *names* used as keys in the main imports record
  external?: boolean | string[];
  markAllExternal?: boolean;
}

export interface ServeOptions {
  pages: PageConfig[];
  api?: Record<string, (req: Request) => Promise<Response>>;
  imports: Record<string, ImportConfig>;
}

type RouteMapping = Record<string, string>;
type ImportMap = { imports: Record<string, string> };

type EntrypointConfig = {
  path: string;
  serverData?: (ctx: MiddlewareContext & { requestId: string; measure: MeasureFn }) => Promise<any>;
};

const filePathCache: Record<string, string> = {};

const getHeaders = (ext: string) => {
  const contentTypes: Record<string, string> = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
  };
  return {
    headers: {
      "Content-Type": contentTypes[ext] || "application/octet-stream",
      ...(process.env.NODE_ENV === 'production' && !['.html'].includes(ext)
        ? { 'Cache-Control': 'public, max-age=31536000, immutable' }
        : { 'Cache-Control': 'no-cache' })
    },
  };
};

async function servePage(
  response: Response,
  importMap: ImportMap,
  handler: (ctx: { requestId: string; measure: MeasureFn }) => Promise<any>,
  requestId: string
): Promise<Response> {
  return await measure(
    async (measure) => {
      let fileStream = response.body;
      if (!fileStream) {
        console.error(`[${requestId}] No ReadableStream in response body`);
        throw new Error("Response body is not a ReadableStream");
      }

      console.log(`[${requestId}] Starting to stream HTML`);

      // Start the handler concurrently
      const handlerTimeout = 5000; // 5 seconds
      const serverDataPromise = Promise.race([
        handler({ requestId, measure }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Handler timed out")), handlerTimeout)
        ),
      ]).catch((err) => {
        console.error(`[${requestId}] Handler error:`, err);
        return { error: "Failed to load server data" };
      });

      // Read the entire HTML file
      let htmlContent = "";
      const reader = fileStream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log(`[${requestId}] fileStream done`);
          break;
        }
        const chunkText = new TextDecoder().decode(value);
        htmlContent += chunkText;
        console.log(
          `[${requestId}] fileStream chunk:`,
          chunkText.substring(0, 100) + (chunkText.length > 100 ? "..." : "")
        );
      }

      if (!htmlContent) {
        console.error(`[${requestId}] HTML content is empty`);
        throw new Error("No HTML content found");
      }

      // Inject import map into <head>
      const importMapScript = `<script type="importmap">${JSON.stringify(importMap)}</script>`;
      console.log(`[${requestId}] Injecting import map:`, importMapScript);
      let modifiedHtml = htmlContent.replace(
        /<head>/i,
        `<head>${importMapScript}`
      );

      // Split at </body>
      const bodyEndIndex = modifiedHtml.toLowerCase().indexOf("</body>");
      if (bodyEndIndex === -1) {
        console.error(`[${requestId}] No </body> tag found in HTML`);
        throw new Error("HTML missing </body> tag");
      }

      const firstChunk = modifiedHtml.substring(0, bodyEndIndex + 7); // Include </body>

      // Create a ReadableStream with two chunks
      const stream = new ReadableStream({
        async start(controller) {
          // Send first chunk immediately
          controller.enqueue(new TextEncoder().encode(firstChunk));

          // Wait for serverData
          const serverData = await serverDataPromise;
          const dataScript = `<script>window.serverData = ${JSON.stringify({
            ...serverData,
            requestId,
          })}</script>`;
          console.log(`[${requestId}] Sending serverData:`, dataScript);

          // Send second chunk
          const secondChunk = `${dataScript}</body></html>`;
          controller.enqueue(new TextEncoder().encode(secondChunk));
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Transfer-Encoding": "chunked",
        },
      });
    },
    "Stream page",
    { requestId, level: 2 }
  );
}

function resolvePagePath(targetPath: string): string {
  const normalizedPath = targetPath.startsWith('/') ? targetPath : path.resolve(process.cwd(), targetPath);

  if (existsSync(normalizedPath)) {
    return normalizedPath;
  }

  throw new Error(`Could not resolve page target. File not found at specified path: "${targetPath}" (checked as: "${normalizedPath}")`);
}

export async function serve(config: ServeOptions) {
  const isDev = process.env.NODE_ENV !== "production";
  const outdir = "./dist";
  const assetsDir = "./assets";

  const routeMap: RouteMapping = {};
  const entrypoints: Record<string, EntrypointConfig> = {};
  const pageHandlers: Record<string, (ctx: MiddlewareContext & { requestId: string; measure: MeasureFn }) => Promise<any>> = {};

  await measure(async (measure) => {
    for (const page of config.pages) {
      const resolvedHtmlPath = await measure(
          async() => resolvePagePath(page.target),
          `Resolve path for ${page.target}`,
          { level: 1 }
      );
      routeMap[page.route] = page.target;
      entrypoints[page.route] = { path: resolvedHtmlPath, serverData: page.handler };

      if (page.handler) {
          pageHandlers[page.route] = page.handler;
      }
    }
  }, "Initialize routes");

  const importMap: ImportMap = { imports: {} };
  const versionMap: Record<string, string> = {};

   await measure(async (measure) => {
        // First pass: Collect all versions specified for base packages
        Object.entries(config.imports).forEach(([_, imp]) => {
            const baseName = imp.name.startsWith("@") ? imp.name.split("/").slice(0, 2).join("/") : imp.name.split("/")[0];
            if (!versionMap[baseName] || imp.version) { 
                 versionMap[baseName] = imp.version ?? "latest";
            }
        });

        // Second pass: Build the import map URLs
        Object.entries(config.imports).forEach(([key, imp]) => {
            let url: string;
            const baseName = imp.name.startsWith("@") ? imp.name.split("/").slice(0, 2).join("/") : imp.name.split("/")[0];
            const version = versionMap[baseName] || 'latest';

            const useStarPrefix = imp.markAllExternal === true;
            const starPrefix = useStarPrefix ? '*' : '';

            url = `https://esm.sh/${starPrefix}${imp.name}@${version}`;

            let queryParts: string[] = [];

             if (imp.external && !useStarPrefix) {
                 let externals: string[] = [];
                 if (Array.isArray(imp.external)) {
                     externals = imp.external;
                 } else if (imp.external === true) {
                     externals = Object.keys(config.imports)
                        .filter(otherKey => otherKey !== key)
                        .map(otherKey => config.imports[otherKey].name.split('/')[0])
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

            // @dev this is needed to prevent an error: Ignored an import map value of "react-dom/": Since specifierKey ended in a slash, so must the address
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

  let serverPort = -1;

  const getBuildConfig = (currentServerPort: number): BuildConfig => ({
    entrypoints: Object.values(entrypoints).map(e => e.path),
    outdir,
    plugins: [plugin],
    minify: !isDev,
    target: "browser",
    sourcemap: isDev ? "linked" : undefined,
    external: Object.keys(importMap.imports),
    define: {
      "process.env.NODE_ENV": JSON.stringify(isDev ? "development" : "production"),
      "process.env.HOST": JSON.stringify(process.env.HOST || (isDev ? `http://localhost:${currentServerPort}` : "")),
    },
    naming: {
      entry: "[dir]/[name]-[hash].[ext]",
      chunk: "[dir]/[name]-[hash].[ext]",
      asset: "[dir]/[name]-[hash].[ext]",
    },
  });

  if (existsSync(outdir)) {
    await measure(async () => rm(outdir, { recursive: true, force: true }), "Clean output directory");
  }

  async function rebuildPage(htmlTargetPath: string, requestId: string): Promise<string | null> {
      if (!isDev) {
         console.warn("`rebuildPage` called in production mode. This should not happen.");
         return filePathCache[htmlTargetPath] || null;
      }

      const route = Object.keys(routeMap).find(r => routeMap[r] === htmlTargetPath);
      if (!route) {
         console.error(`Cannot find route associated with target path: ${htmlTargetPath}`);
         return null;
      }
      const entryConfig = entrypoints[route];
      if (!entryConfig) {
         console.error(`Cannot find entrypoint config for route: ${route}`);
         return null;
      }
      const resolvedHtmlPath = entryConfig.path;

      return await measure(
          async (measure) => {
              try {
                  const currentBuildConfig = getBuildConfig(serverPort);
                  const result = await build({
                      ...currentBuildConfig,
                      entrypoints: [resolvedHtmlPath]
                   });

                  if (result.success && result.outputs) {
                      const outputHtml = result.outputs.find(o => o.kind === 'entry-point' && path.resolve(o.path) !== resolvedHtmlPath && o.path.endsWith('.html'));
                      if (outputHtml) {
                          const outputPath = path.resolve(outputHtml.path);
                          filePathCache[htmlTargetPath] = outputPath;
                          return outputPath;
                      } else {
                           console.error(`Build succeeded but no output HTML found for entrypoint: ${resolvedHtmlPath}`);
                      }
                  } else {
                      console.error(`Failed to rebuild page: ${htmlTargetPath}`);
                      if (result.logs.length > 0) {
                          console.error("Build Logs:", result.logs);
                      }
                  }
              } catch (error) {
                  console.error(`Error during rebuild of ${htmlTargetPath}:`, error);
              }
              return null;
          },
          `Rebuild ${path.basename(htmlTargetPath)}`,
          { requestId }
      );
  }

  const server = Bun.serve({
    port: process.env.BUN_PORT ? parseInt(process.env.BUN_PORT, 10) : undefined,
    development: isDev,
    async fetch(req) {
      const requestId = randomUUID().split("-")[0];
      const reqWithId = req.headers.has("X-Request-ID")
        ? req
        : new Request(req.url, {
            ...req,
            headers: { ...Object.fromEntries(req.headers.entries()), "X-Request-ID": requestId },
          });

      return await measure(
        async (measure) => {
          const url = new URL(reqWithId.url);
          const pathname = url.pathname;

          // 1. Check for API routes first
          if (config.api && config.api[pathname]) {
            return await measure(
              async () => config.api![pathname](reqWithId),
              `api ${pathname}`,
              { level: 1 }
            );
          }

          // 2. Check for page routes
          if (entrypoints[pathname]) {
              const originalTargetPath = routeMap[pathname];

              return await measure(
                  async (measure) => {
                      let builtHtmlPath: string | null = null;

                      if (isDev) {
                          builtHtmlPath = await rebuildPage(originalTargetPath, requestId);
                      } else {
                          builtHtmlPath = filePathCache[originalTargetPath];
                          if (!builtHtmlPath) {
                              console.error(`Production cache miss for ${originalTargetPath}. File should exist in dist.`);
                              return new Response("Internal Server Error: Page not found in build cache.", { status: 500 });
                          }
                      }

                      if (!builtHtmlPath) {
                          return new Response(`Failed to build or find page: ${originalTargetPath}`, { status: 500 });
                      }

                       const htmlFile = Bun.file(builtHtmlPath);
                       if (!(await htmlFile.exists())) {
                           console.error(`Built HTML file not found at path: ${builtHtmlPath}`);
                           return new Response("Internal Server Error: Built page artifact not found.", { status: 500 });
                       }

                       if (pageHandlers[pathname]) {
                        const routeFile = routeMap[pathname];
                        return await measure(
                          async (measure) => {
                            const ext = path.extname(routeFile);
                            const baseName = path.basename(routeFile, ext).toLowerCase();
                            const cacheKey = `${baseName}${ext}`;
                            const filePath = filePathCache[cacheKey];
                      
                            if (!filePath || !await Bun.file(filePath).exists()) {
                              throw new Error(`Page not found: ${routeFile}`);
                            }
                      
                            const htmlFile = Bun.file(filePath);
                            return await servePage(
                              new Response(htmlFile.stream(), getHeaders(ext)),
                              importMap,
                              (ctx) => pageHandlers[pathname](reqWithId),
                              requestId
                            );
                          },
                          `page ${pathname}`
                        );
                      }

                      // const query = Object.fromEntries(url.searchParams.entries());
                      // const ctx = {
                      //     request: reqWithId,
                      //     method: reqWithId.method,
                      //     path: url.pathname,
                      //     query,
                      //     // Avoid parsing body unless it's needed and method allows it
                      //     body: (reqWithId.method !== "GET" && reqWithId.method !== "HEAD") ? await reqWithId.json().catch(() => ({})) : undefined,
                      //     headers: reqWithId.headers,
                      //     requestId,
                      //     measure, // Pass the measure function into the handler context
                      //  };
                  },
                  `page ${pathname}`
              );
          }

          // 3. Check for built assets in `outdir` (after build)
          const distPath = path.join(process.cwd(), outdir, pathname.startsWith('/') ? pathname.substring(1) : pathname);
          const distFile = Bun.file(distPath);
          if (await distFile.exists()) {
              return new Response(distFile, getHeaders(path.extname(pathname)));
          }

          // 4. Check for static assets in `assetsDir`
          const assetsPath = path.join(process.cwd(), assetsDir, pathname.startsWith('/') ? pathname.substring(1) : pathname);
          const assetFile = Bun.file(assetsPath);
           if (await assetFile.exists()) {
               return new Response(assetFile, getHeaders(path.extname(pathname)));
           }


          // 5. Not found
          return new Response("Route Not Found", { status: 404 });
        },
        `${req.method} ${req.url}`,
        { requestId }
      );
    },
    error(error: Error) {
      console.error("[Server Error]", error);
      const body = isDev
        ? `<h1>Server Error</h1><pre>${error.stack || error.message}</pre>`
        : "Internal Server Error";
      return new Response(body, {
        status: 500,
        headers: { "Content-Type": "text/html" },
      });
    },
  });

  serverPort = server.port;
  console.log(`🦊 Melina server running at http://localhost:${serverPort}`);

  await measure(async () => {
    const initialBuildConfig = getBuildConfig(serverPort);
    const result = await build(initialBuildConfig);

    if (result.success && result.outputs) {
        console.log("Initial build successful. Outputs:");
        result.outputs.forEach(output => {
            console.log(` - ${output.kind}: ${output.path} (${(output.size / 1024).toFixed(2)} KB)`);
             const entrypointPath = Object.values(entrypoints).find(e => path.resolve(e.path) === path.resolve(output.path));
             if (entrypointPath) {
                 const originalTarget = Object.keys(routeMap).find(r => entrypoints[r].path === entrypointPath.path);
                 if(originalTarget) {
                    filePathCache[routeMap[originalTarget]] = path.resolve(output.path);
                 }
             }
        });

         for (const route in entrypoints) {
             const originalTarget = routeMap[route];
             const baseName = path.basename(originalTarget, path.extname(originalTarget));

             const potentialOutput = result.outputs.find(o => o.kind === 'entry-point' && o.path.includes(baseName));
             if(potentialOutput) {
                 filePathCache[originalTarget] = path.resolve(potentialOutput.path);
                 console.log(`Cached mapping: ${originalTarget} -> ${filePathCache[originalTarget]}`);
             } else {
                 console.warn(`Could not determine output path for entrypoint ${originalTarget} during initial build cache population.`);
             }
         }

    } else {
        if (result.logs.length > 0) {
            console.error("Build Logs:", result.logs);
        }
        throw new Error("Initial build failed, cannot start server.");
    }
  }, "Initial build");

  return server;
}

/**
 * Generates import configurations by reading package.json and optional bun.lock data
 *
 * @param packageJson - The parsed package.json file (as an object)
 * @param bunLock - The parsed bun.lock file (as an object, optional)
 * @returns Record<string, ImportConfig> - Map where key is typically the import specifier (e.g., 'react', 'react-dom/client')
 */
export function generateImports(
  packageJson: any,
  bunLock: any = null
): Record<string, ImportConfig> {
  const dependencies = {
    ...(packageJson.dependencies || {}),
  };

  const getCleanVersion = (version: string): string => version.replace(/^[~^]/, '');

  const imports: Record<string, ImportConfig> = {};

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

    // @dev Import maps supports trailing slash that can not work with URL search params friendly. To fix this issue, esm.sh provides a special format for import URL that allows you to use query params with trailing slash: change the query prefix ? to & and put it after the package version.
    const nameWithSuffix = `${name}/`;

    imports[nameWithSuffix] = {
      name: name,
      version: cleanVersion,
      ...(peerDeps.length > 0 ? { deps: peerDeps } : {}),
    };
  });

  return imports;
}