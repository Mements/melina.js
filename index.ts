import { build, type BuildConfig } from "bun";
import plugin from "bun-plugin-tailwind"; // Assuming this plugin exists and works
import { existsSync } from "fs";
import { rm } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
// Removed unused readdir import: import { readdir } from "node:fs/promises";

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

// Keep measure function as is - seems fine

export async function measure<T>(
    fn: (measure: typeof measure) => Promise<T>,
    action: string,
    context: MeasureContext = {}
): Promise<T> {
    const start = performance.now();
    const level = context.level || 0;
    let indent = "=".repeat(level > 0 ? level + 1: 0); // Indent fix for level 0
    const requestId = context.requestId;
    // Use different symbols for start/end for clarity
    let logPrefixStart = requestId ? `[${requestId}] ${indent}>` : `${indent}>`;
    let logPrefixEnd = requestId ? `[${requestId}] ${indent}<` : `${indent}<`;

    try {
        // Log start immediately
        console.log(`${logPrefixStart} ${action}...`);

        const result = await fn((nestedFn, nestedAction) =>
            measure(nestedFn, nestedAction, {
                requestId: requestId, // Pass requestId down
                level: level + 1,
                parentAction: action
            })
        );

        const duration = performance.now() - start;
        // Log success
        console.log(`${logPrefixEnd} ${action} ✓ ${duration.toFixed(2)}ms`);
        return result;
    } catch (error) {
        const duration = performance.now() - start;
        console.log('=========================== ERROR ===========================');
        // Log failure
        console.log(`${logPrefixEnd} ${action} ✗ ${duration.toFixed(2)}ms`);
        // Log the error itself for better debugging
        if (error instanceof Error) {
             console.error(`Error in action "${action}":`, error.message);
             if(error.stack) console.error(error.stack);
        } else {
             console.error(`Unknown error in action "${action}":`, error);
        }
        console.log('=============================================================');
        // Re-throw the error so it propagates if not handled elsewhere
        throw error; // Changed from swallowing the error
    }
}


interface PageConfig {
  route: string;
  // Allow target to be any HTML file path
  target: string; // Removed the implicit "name" concept
  handler?: (ctx: MiddlewareContext & { requestId: string; measure: MeasureFn }) => Promise<any>; // Added MiddlewareContext here
}

// Define MiddlewareContext (if not already globally defined)
type MiddlewareContext = {
    request: Request;
    method: string;
    path: string;
    query: Record<string, string | number | boolean>; // Query type was Record<string, string> - expanded slightly
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
  // Use Record<string, ImportConfig> as defined
  imports: Record<string, ImportConfig>; // Key should typically match the package name/path
}

type RouteMapping = Record<string, string>;
type ImportMap = { imports: Record<string, string> };

type EntrypointConfig = {
  path: string; // This will now be the direct path to the HTML file
  serverData?: (ctx: MiddlewareContext & { requestId: string; measure: MeasureFn }) => Promise<any>;
};

const filePathCache: Record<string, string> = {}; // Cache built file paths (key: original html path -> value: output path)

const getHeaders = (ext: string) => {
  const contentTypes: Record<string, string> = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    // Add more as needed
  };
  return {
    headers: {
      "Content-Type": contentTypes[ext] || "application/octet-stream",
      // Add Cache-Control headers, especially for built assets in production
      ...(process.env.NODE_ENV === 'production' && !['.html'].includes(ext)
        ? { 'Cache-Control': 'public, max-age=31536000, immutable' }
        : { 'Cache-Control': 'no-cache' }) // No cache for HTML or dev assets
    },
  };
};

async function servePage(
  response: Response,
  importMap: ImportMap,
  serverData = {},
  requestId: string
): Promise<Response> {
  // Keep servePage function as is - seems fine
    return await measure(
        async (measure) => {
            const rewriter = new HTMLRewriter()
                .on("head", {
                    element(element) {
                        element.prepend(
                            `<script type="importmap">${JSON.stringify(importMap)}</script>`,
                            { html: true }
                        );
                    },
                })
                .on("body", {
                    element(element) {
                        const data = { ...serverData, requestId };
                        element.append(
                            `<script>window.serverData = ${JSON.stringify(data)}</script>`,
                            { html: true }
                        );
                    },
                });

          const transformedResponse = rewriter.transform(response);
          const transformedHtml = await transformedResponse.text();
          return new Response(transformedHtml, getHeaders(".html"));          
        },
        "Transform page",
        { requestId, level: 2 }
    );
}


// *** MODIFIED FUNCTION ***
// Simplified resolver: checks if the direct target path exists.
function resolvePagePath(targetPath: string): string {
  // Check if the path is relative, prepend './' if necessary for existsSync
  const normalizedPath = targetPath.startsWith('/') ? targetPath : path.resolve(process.cwd(), targetPath);

  if (existsSync(normalizedPath)) {
    return normalizedPath; // Return the absolute path if it exists
  }

  // If the specified path doesn't exist, throw an error.
  throw new Error(`Could not resolve page target. File not found at specified path: "${targetPath}" (checked as: "${normalizedPath}")`);
}

export async function serve(config: ServeOptions) {
  const isDev = process.env.NODE_ENV !== "production";
  const outdir = "./dist";
  const assetsDir = "./assets"; // Serve files from here directly

  const routeMap: RouteMapping = {}; // Maps route -> original HTML target path
  const entrypoints: Record<string, EntrypointConfig> = {}; // Maps route -> { path: resolved HTML path, serverData }
  const pageHandlers: Record<string, (ctx: MiddlewareContext & { requestId: string; measure: MeasureFn }) => Promise<any>> = {}; // Maps route -> server data handler

  await measure(async (measure) => {
    for (const page of config.pages) {
      const resolvedHtmlPath = await measure(
          async() => resolvePagePath(page.target),
          `Resolve path for ${page.target}`,
          { level: 1 }
      );
      routeMap[page.route] = page.target; // Store the original target path for reference/rebuilds
      entrypoints[page.route] = { path: resolvedHtmlPath, serverData: page.handler }; // Store resolved path

      if (page.handler) {
          pageHandlers[page.route] = page.handler; // Register the data handler
      }
    }
  }, "Initialize routes");

  const importMap: ImportMap = { imports: {} };
  const versionMap: Record<string, string> = {}; // Stores base package name -> version

  // --- Import Map Generation Logic ---
   await measure(async (measure) => {
        // First pass: Collect all versions specified for base packages
        Object.entries(config.imports).forEach(([_, imp]) => {
            const baseName = imp.name.startsWith("@") ? imp.name.split("/").slice(0, 2).join("/") : imp.name.split("/")[0];
            if (!versionMap[baseName] || imp.version) { // Prioritize explicitly set versions
                 versionMap[baseName] = imp.version ?? "latest";
            }
        });

        // Second pass: Build the import map URLs
        Object.entries(config.imports).forEach(([key, imp]) => {
            let url: string;
            const baseName = imp.name.startsWith("@") ? imp.name.split("/").slice(0, 2).join("/") : imp.name.split("/")[0];
            const version = versionMap[baseName] || 'latest'; // Use collected version

            const useStarPrefix = imp.markAllExternal === true;
            const starPrefix = useStarPrefix ? '*' : '';

            // Construct base URL using the collected version
            url = `https://esm.sh/${starPrefix}${imp.name}@${version}`;

            let queryParts: string[] = [];

            // Handle external dependencies
             if (imp.external && !useStarPrefix) {
                 let externals: string[] = [];
                 if (Array.isArray(imp.external)) {
                     externals = imp.external;
                 } else if (imp.external === true) {
                     // Automatically mark all *other* defined imports as external
                     externals = Object.keys(config.imports)
                        .filter(otherKey => otherKey !== key) // Exclude self
                        .map(otherKey => config.imports[otherKey].name.split('/')[0]) // Get base name
                        .filter((value, index, self) => self.indexOf(value) === index); // Unique base names
                 }
                 if (externals.length > 0) {
                    queryParts.push(`external=${externals.join(',')}`);
                 }
             }

            // Handle explicit dependencies ('deps')
             if (imp.deps?.length) {
                 const depsList = imp.deps
                     .map((depName) => {
                         // Find the version for the dependency from the versionMap
                         const depBaseName = depName.startsWith("@") ? depName.split("/").slice(0, 2).join("/") : depName.split("/")[0];
                         const depVersion = versionMap[depBaseName] || 'latest';
                         return `${depName}@${depVersion}`;
                     })
                     .join(",");
                 queryParts.push(`deps=${depsList}`);
             }

            if (isDev) queryParts.push("dev"); // Add dev flag for esm.sh sourcemaps etc.

            // otherwise, devtools shows an error: Ignored an import map value of "react-dom/": Since specifierKey ended in a slash, so must the address
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

  let serverPort = -1; // Will be updated after server starts

  // Define build config *after* serverPort is potentially known
  const getBuildConfig = (currentServerPort: number): BuildConfig => ({
    // Entrypoints will be dynamically set during rebuilds, but initial build uses all HTML targets
    entrypoints: Object.values(entrypoints).map(e => e.path),
    outdir,
    plugins: [plugin], // Ensure plugin is called if it's a factory function
    minify: !isDev,
    target: "browser",
    sourcemap: isDev ? "linked" : undefined, // Only linked sourcemaps in dev
    // `packages: "external"` might not be needed if `external` array is comprehensive
    external: Object.keys(importMap.imports), // Mark all mapped imports as external
    define: {
      "process.env.NODE_ENV": JSON.stringify(isDev ? "development" : "production"),
      "process.env.HOST": JSON.stringify(process.env.HOST || (isDev ? `http://localhost:${currentServerPort}` : "")),
    },
    naming: {
      // Use content hashing for better cache busting
      entry: "[dir]/[name]-[hash].[ext]",
      chunk: "[dir]/[name]-[hash].[ext]",
      asset: "[dir]/[name]-[hash].[ext]",
    },
  });

  // Clear output directory before initial build
  if (existsSync(outdir)) {
    await measure(async () => rm(outdir, { recursive: true, force: true }), "Clean output directory");
  }

  // --- Rebuild Function ---
  // Rebuilds a specific HTML entrypoint and updates the cache
  async function rebuildPage(htmlTargetPath: string, requestId: string): Promise<string | null> {
      // Only rebuild in development mode
      if (!isDev) {
         console.warn("`rebuildPage` called in production mode. This should not happen.");
         return filePathCache[htmlTargetPath] || null; // Return cached path if exists
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
      const resolvedHtmlPath = entryConfig.path; // Use the resolved absolute path

      return await measure(
          async (measure) => {
              try {
                  // Get the latest build config with the current port
                  const currentBuildConfig = getBuildConfig(serverPort);
                  const result = await build({
                      ...currentBuildConfig,
                      entrypoints: [resolvedHtmlPath] // Build only the requested HTML file
                   });

                  if (result.success && result.outputs) {
                      // Find the output HTML file corresponding to the entrypoint
                      const outputHtml = result.outputs.find(o => o.kind === 'entry-point' && path.resolve(o.path) !== resolvedHtmlPath && o.path.endsWith('.html')); // Find the *output* html path
                      if (outputHtml) {
                          const outputPath = path.resolve(outputHtml.path);
                          filePathCache[htmlTargetPath] = outputPath; // Cache: original target path -> output path
                          return outputPath; // Return the path to the built HTML
                      } else {
                           console.error(`Build succeeded but no output HTML found for entrypoint: ${resolvedHtmlPath}`);
                           // Maybe look for JS/CSS outputs related to it?
                           // For now, assume HTML output is needed.
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
              return null; // Return null on failure
          },
          `Rebuild ${path.basename(htmlTargetPath)}`,
          { requestId }
      );
  }

  // --- Server Definition ---
  const server = Bun.serve({
    port: process.env.BUN_PORT ? parseInt(process.env.BUN_PORT, 10) : undefined, // Use BUN_PORT env var
    development: isDev,
    async fetch(req) {
      const requestId = randomUUID().split("-")[0];
      // Inject request ID header if not present
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
              async () => config.api![pathname](reqWithId), // Pass request with ID
              `api ${pathname}`,
              { level: 1 }
            );
          }

          // 2. Check for page routes
          if (entrypoints[pathname]) {
              const originalTargetPath = routeMap[pathname]; // Get the original target path used as key
              console.log('===> index.ts:415 ~ originalTargetPath', originalTargetPath);
              const resolvedEntryPath = entrypoints[pathname].path; // Get resolved path for reading
              const handler = pageHandlers[pathname]; // Get the data handler

              return await measure(
                  async (measure) => {
                      let builtHtmlPath: string | null = null;

                      if (isDev) {
                          // Always rebuild in dev mode
                          builtHtmlPath = await rebuildPage(originalTargetPath, requestId);
                      } else {
                          // In production, check cache first
                          builtHtmlPath = filePathCache[originalTargetPath];
                          // Optional: Could add a check here `existsSync(builtHtmlPath)`
                          // If file doesn't exist in prod (e.g. deleted from dist), return 404 or attempt rebuild?
                          // For simplicity, assume initial build populated the cache correctly for prod.
                          if (!builtHtmlPath) {
                              console.error(`Production cache miss for ${originalTargetPath}. File should exist in dist.`);
                              // Attempting a rebuild in production might be risky/slow
                              // builtHtmlPath = await rebuildPage(originalTargetPath, requestId); // Avoid this generally
                               return new Response("Internal Server Error: Page not found in build cache.", { status: 500 });
                          }
                      }

                      if (!builtHtmlPath) {
                          return new Response(`Failed to build or find page: ${originalTargetPath}`, { status: 500 });
                      }

                      // Serve the *built* HTML file
                       const htmlFile = Bun.file(builtHtmlPath);
                       if (!(await htmlFile.exists())) {
                           console.error(`Built HTML file not found at path: ${builtHtmlPath}`);
                           return new Response("Internal Server Error: Built page artifact not found.", { status: 500 });
                       }


                      // Fetch server data if handler exists
                      let serverData = {};
                      if (handler) {
                           const query = Object.fromEntries(url.searchParams.entries());
                           const ctx = {
                               request: reqWithId,
                               method: reqWithId.method,
                               path: url.pathname,
                               query,
                               // Avoid parsing body unless it's needed and method allows it
                               body: (reqWithId.method !== "GET" && reqWithId.method !== "HEAD") ? await reqWithId.json().catch(() => ({})) : undefined,
                               headers: reqWithId.headers,
                               requestId,
                               measure, // Pass the measure function into the handler context
                            };
                           serverData = await measure(
                               async () => handler(ctx), // Pass full context
                               `serverData ${pathname}`,
                               { level: 1 }
                           );
                      }

                      // Serve the page, injecting import map and server data
                       return await servePage(
                           new Response(htmlFile, getHeaders(".html")), // Serve the content of the built file
                           importMap,
                           serverData,
                           requestId
                       );
                  },
                  `page ${pathname}`
              );
          }

          // 3. Check for built assets in `outdir` (after build)
          // Construct path relative to the output directory
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
        `${req.method} ${req.url}`, // Log includes method and full URL
        { requestId } // Top-level measure context with request ID
      );
    },
    error(error: Error) { // Type the error
      console.error("[Server Error]", error);
      // Provide more helpful error response in development
      const body = isDev
        ? `<h1>Server Error</h1><pre>${error.stack || error.message}</pre>`
        : "Internal Server Error";
      return new Response(body, {
        status: 500,
        headers: { "Content-Type": "text/html" },
      });
    },
  });

  serverPort = server.port; // Capture the actual port used by the server
  console.log(`🦊 Melina server running at http://localhost:${serverPort}`);

  // --- Initial Build ---
  await measure(async () => {
    const initialBuildConfig = getBuildConfig(serverPort); // Use the actual port
    const result = await build(initialBuildConfig);

    if (result.success && result.outputs) {
        console.log("Initial build successful. Outputs:");
        result.outputs.forEach(output => {
            console.log(` - ${output.kind}: ${output.path} (${(output.size / 1024).toFixed(2)} KB)`);
            // Find the original entrypoint path based on the output path
             const entrypointPath = Object.values(entrypoints).find(e => path.resolve(e.path) === path.resolve(output.path)); // Direct match for entrypoints
             if (entrypointPath) {
                 const originalTarget = Object.keys(routeMap).find(r => entrypoints[r].path === entrypointPath.path);
                 if(originalTarget) {
                    // Cache mapping: original target -> final output path
                    filePathCache[routeMap[originalTarget]] = path.resolve(output.path);
                 }
             } else {
                 // Handle non-entrypoint outputs if necessary (e.g., caching JS/CSS paths)
                 // This might require more sophisticated manifest parsing from Bun build results if available
             }
        });

         for (const route in entrypoints) {
             const entryConfig = entrypoints[route];
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
    // ...(packageJson.devDependencies || {}),
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

    // Import maps supports trailing slash that can not work with URL search params friendly. To fix this issue, esm.sh provides a special format for import URL that allows you to use query params with trailing slash: change the query prefix ? to & and put it after the package version.
    const nameWithSuffix = `${name}/`;

    imports[nameWithSuffix] = {
      name: name,
      version: cleanVersion,
      ...(peerDeps.length > 0 ? { deps: peerDeps } : {}),
    };
  });

  return imports;
}