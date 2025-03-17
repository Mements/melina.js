import { build, type BuildConfig } from "bun";
import plugin from "bun-plugin-tailwind";
import { existsSync } from "fs";
import { rm } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { readdir } from "node:fs/promises";

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
  let indent = "=".repeat(level);
  const requestId = context.requestId;
  let logPrefix = requestId ? `[${requestId}] ${indent}>` : `${indent}>`;

  try {
    indent = ">".repeat(level);
    logPrefix = requestId ? `[${requestId}] ${indent}$` : `${indent}$`;
    console.log(`${logPrefix} ${action}...`);

    const result = await fn((nestedFn, nestedAction) =>
      measure(nestedFn, nestedAction, {
        requestId: requestId ? `${requestId}` : undefined,
        level: level + 1,
        parentAction: action
      })
    );

    const duration = performance.now() - start;
    indent = "<".repeat(level);
    logPrefix = requestId ? `[${requestId}] ${indent}$` : `${indent}$`;
    console.log(`${logPrefix} ${action} ✓ ${duration.toFixed(2)}ms`);
    return result;
  } catch (error) {
    const duration = performance.now() - start;
    console.log('===========================');
    console.log(`\n${logPrefix} ${action} ✗ ${duration.toFixed(2)}ms`, error);
    console.log('===========================');
    // throw new Error(`${action} failed: ${error}`);
  }
}

interface PageConfig {
  route: string;
  target: string;
  handler?: (ctx: { requestId: string; measure: MeasureFn }) => Promise<any>;
}

interface ImportConfig {
  name: string;
  version?: string;
  deps?: string[];
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
    },
  };
};

async function servePage(
  response: Response,
  importMap: ImportMap,
  serverData = {},
  requestId: string
): Promise<Response> {
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

function resolvePagePath(targetName: string): string {
  if (targetName.startsWith("./")) {
    return targetName;
  }

  const possiblePaths = [
    `./pages/${targetName}/${targetName}.html`,
    `./pages/${targetName}/index.html`,
    `./pages/${targetName}/App.html`
  ];

  for (const possiblePath of possiblePaths) {
    if (existsSync(possiblePath)) {
      return possiblePath;
    }
  }

  return possiblePaths[0];
}

export async function serve(config: ServeOptions) {
  const isDev = process.env.NODE_ENV !== "production";
  const outdir = "./dist";
  const assetsDir = "./assets";

  const routeMap: RouteMapping = {};
  const entrypoints: Record<string, EntrypointConfig> = {};
  const pageHandlers: Record<string, (req: Request) => Promise<any>> = {};

  await measure(async (measure) => {
    for (const page of config.pages) {
      const targetPath = await resolvePagePath(page.target);
      const relativePath = targetPath.startsWith("./") ? targetPath.substring(2) : targetPath;
      routeMap[page.route] = relativePath;
      entrypoints[page.route] = { path: targetPath, serverData: page.handler };
      pageHandlers[page.route] = async (req) => {
        const url = new URL(req.url);
        const query = Object.fromEntries(url.searchParams);
        const requestId = req.headers.get("X-Request-ID") || randomUUID().split('-')[0];
        const ctx = {
          request: req,
          method: req.method,
          path: url.pathname,
          query,
          body: req.method !== "GET" ? await req.json().catch(() => ({})) : undefined,
          headers: req.headers,
          requestId,
          measure,
        };

        return page.handler ? await page.handler(ctx) : {};
      };
    }
  }, "Initialize routes");

  const importMap: ImportMap = { imports: {} };
  const versionMap: Record<string, string> = {};

  Object.entries(config.imports).forEach(([key, imp]) => {
    if (imp.name.startsWith("@")) {
      versionMap[imp.name] = imp.version ?? "latest";
    } else {
      const baseName = imp.name.split("/")[0];
      versionMap[baseName] = imp.version ?? "latest";
    }
  });

  Object.entries(config.imports).forEach(([key, imp]) => {
    let url: string;

    const useStarPrefix = imp.markAllExternal === true;

    if (imp.name.startsWith("@")) {
      url = `https://esm.sh/${useStarPrefix ? '*' : ''}${imp.name}@${versionMap[imp.name]}`;
    } else {
      const parts = imp.name.split("/");
      const baseName = parts[0];
      const subPaths = parts.slice(1);

      url = `https://esm.sh/${useStarPrefix ? '*' : ''}${baseName}@${versionMap[baseName]}`;
      if (subPaths.length > 0) url += `/${subPaths.join("/")}`;
    }

    let queryParts: string[] = [];

    if (imp.external && !useStarPrefix) {
      if (Array.isArray(imp.external)) {
        queryParts.push(`external=${imp.external.join(',')}`);
      } else if (imp.external === true) {
        const allDeps = Object.entries(config.imports)
          .filter(([depKey]) => depKey !== key)
          .map(([_, depImp]) => depImp.name.split('/')[0]);

        const uniqueDeps = [...new Set(allDeps)];
        if (uniqueDeps.length > 0) {
          queryParts.push(`external=${uniqueDeps.join(',')}`);
        }
      }
    }

    if (imp?.deps?.length) {
      const depsList = imp.deps
        .map((dep) => `${dep}@${versionMap[dep.split("/")[0]]}`)
        .join(",");
      queryParts.push(`deps=${depsList}`);
    }

    if (isDev) queryParts.push("dev");
    if (queryParts.length) url += `?${queryParts.join("&")}`;

    importMap.imports[key] = url;
  });

  let serverPort = -1;
  const buildConfig: BuildConfig = {
    entrypoints: Object.values(entrypoints).map((e) => e.path),
    outdir,
    plugins: [plugin],
    minify: !isDev,
    target: "browser",
    sourcemap: "linked",
    packages: "external",
    external: Object.keys(importMap.imports),
    define: {
      "process.env.NODE_ENV": JSON.stringify(isDev ? "development" : "production"),
      "process.env.HOST": process.env.HOST || (isDev ? `http://localhost:${serverPort}` : ""),
    },
    naming: {
      chunk: "[name].[hash].[ext]",
      entry: "[name].[hash].[ext]",
    },
  };

  if (existsSync(outdir)) {
    await rm(outdir, { recursive: true, force: true });
  }

  async function rebuildPage(pagePath: string, requestId: string): Promise<any> {
    if (isDev) {
      const baseName = path.basename(pagePath).split(".")[0].toLowerCase();
      const entrypoint = Object.values(entrypoints).find((e) =>
        path.basename(e.path).split(".")[0].toLowerCase() === baseName
      );
      if (!entrypoint) return null;

      return await measure(
        async (measure) => {
          try {
            const result = await build({ ...buildConfig, entrypoints: [entrypoint.path] });

            if (result && result.outputs) {
              for (const output of result.outputs) {
                const outputBaseName = path.basename(output.path).split(".")[0].toLowerCase();
                const ext = path.extname(output.path);
                filePathCache[`${outputBaseName}${ext}`] = output.path;
              }
            }

            return result;
          } catch (error) {
            console.error("Failed to rebuild page:", error);
            return null;
          }
        },
        `Rebuild ${baseName}`,
        { requestId }
      );
    }
    return null;
  }

  const server = Bun.serve({
    port: process.env.BUN_PORT,
    development: isDev,
    async fetch(req) {
      const requestId = randomUUID().split("-")[0];
      const newHeaders = new Headers(req.headers);
      if (!newHeaders.has("X-Request-ID")) {
        newHeaders.append("X-Request-ID", requestId);
      }
      const reqWithId = new Request(req, { headers: newHeaders });

      return await measure(
        async (measure) => {
          const url = new URL(reqWithId.url);
          const pathname = url.pathname;

          const distPath = path.join(process.cwd(), outdir, pathname);
          if (await Bun.file(distPath).exists()) {
            return new Response(Bun.file(distPath), getHeaders(path.extname(pathname)));
          }

          const assetsPath = path.join(process.cwd(), assetsDir, pathname);
          if (await Bun.file(assetsPath).exists()) {
            return new Response(Bun.file(assetsPath), getHeaders(path.extname(pathname)));
          }

          if (pageHandlers[pathname]) {
            const routeFile = routeMap[pathname];
            return await measure(
              async (measure) => {
                const ext = path.extname(routeFile);
                const baseName = path.basename(routeFile, ext);
                let htmlFile: any = null;

                if (isDev) {
                  // In dev mode, always rebuild the page
                  const buildResult = await rebuildPage(routeFile, requestId);
                  if (buildResult) {
                    const builtFile = buildResult.outputs.find((o: { path: string }) =>
                      o.path.endsWith(ext)
                    );
                    if (builtFile) {
                      htmlFile = Bun.file(builtFile.path);
                    }
                  }
                } else {
                  // In production mode, check the cache first
                  const cacheKey = `${baseName.toLowerCase()}${ext}`;
                  if (filePathCache[cacheKey] && await Bun.file(filePathCache[cacheKey]).exists()) {
                    htmlFile = Bun.file(filePathCache[cacheKey]);
                  }

                  // If not in cache or file doesn't exist, rebuild
                  if (!htmlFile) {
                    const buildResult = await rebuildPage(routeFile, requestId);
                    if (buildResult) {
                      const builtFile = buildResult.outputs.find((o: { path: string }) =>
                        o.path.endsWith(ext)
                      );
                      if (builtFile) {
                        htmlFile = Bun.file(builtFile.path);
                      }
                    }
                  }
                }

                if (!htmlFile) {
                  throw new Error(`Page not found: ${routeFile}`);
                }

                let serverData = {};
                const handler = pageHandlers[pathname];
                if (handler) {
                  serverData = await measure(
                    async (measure) => handler(reqWithId),
                    `serverData ${pathname}`
                  );
                }

                return await servePage(
                  new Response(htmlFile, getHeaders(ext)),
                  importMap,
                  serverData,
                  requestId
                );
              },
              `page ${pathname}`
            );
          }

          if (config.api && pathname in config.api) {
            return await measure(
              async (measure) => config.api![pathname](reqWithId),
              `endpoint ${pathname}`
            );
          }

          return new Response("Route Not Found", { status: 404 });
        },
        `${req.method} ${req.url}`,
        { requestId }
      );
    },
    error(error) {
      console.error("Server Error:", error);
      return new Response(
        `<pre>${error}\n${error.stack}</pre>`,
        { headers: { "Content-Type": "text/html" }, status: 500 }
      );
    },
  });

  serverPort = server.port;

  await measure(async () => {
    const result = await build(buildConfig);

    if (result && result.outputs) {
      for (const output of result.outputs) {
        const outputBaseName = path.basename(output.path).split(".")[0].toLowerCase();
        const ext = path.extname(output.path);
        filePathCache[`${outputBaseName}${ext}`] = output.path;
      }
    }
  }, "Initial build");

  return server;
}

if (require.main === module) {
  const exampleConfig: ServeOptions = {
    pages: [
      {
        route: "/",
        target: "./pages/index.tsx",
        handler: async (ctx) => ({ message: `Hello from ${ctx.path}` }),
      },
    ],
    api: {
      "/api/health": async (req) =>
        new Response(JSON.stringify({ status: "ok" }), {
          headers: { "Content-Type": "application/json" },
        }),
    },
    imports: [
      { name: "react", version: "18.2.0" },
      { name: "react-dom/client", version: "18.2.0" },
    ],
  };

  serve(exampleConfig);
}

/**
 * Generates import configurations by reading package.json and optional bun.lock data
 * 
 * @param packageJson - The parsed package.json file
 * @param bunLock - The parsed bun.lock file (optional)
 * @returns Record of import configurations
 */
export function generateImports(
  packageJson: any,
  bunLock: any = { packages: {} }
) {
  const dependencies = {
    ...packageJson.dependencies || {},
    ...packageJson.devDependencies || {}
  };

  // Helper function to get clean version (no ^ or ~)
  const getCleanVersion = (version: string) => version.replace(/^\^|~/, '');

  // Helper function to get version from package.json
  const getVersionFromPackageJson = (packageName: string) => {
    const version = dependencies[packageName];
    return version ? getCleanVersion(version) : null;
  };

  // Create the imports object
  const imports: Record<string, any> = {};

  // Process dependencies
  Object.entries(dependencies).forEach(([name, version]) => {
    const cleanVersion = getCleanVersion(version as string);

    // Check if this package exists in the lockfile
    const lockPackage = bunLock.packages && bunLock.packages[name];
    const peerDeps: string[] = [];

    if (lockPackage) {
      // Lock file format is [nameWithVersion, _, metadata, hash]
      const metadata = lockPackage[2];

      if (metadata && metadata.peerDependencies) {
        // Process peer dependencies
        Object.keys(metadata.peerDependencies).forEach(peerName => {
          // Skip optional peers
          if (metadata.optionalPeers && metadata.optionalPeers.includes(peerName)) {
            return;
          }

          // Use version from package.json if available
          const peerVersion = getVersionFromPackageJson(peerName);
          if (peerVersion) {
            peerDeps.push(peerName);
          }
        });
      }
    }

    // Add the import configuration
    imports[name] = {
      name,
      version: cleanVersion,
      ...(peerDeps.length > 0 ? { deps: peerDeps } : {})
    };
  });

  if (imports['react-dom']) {
    imports['react-dom/client'] = {
      ...imports['react-dom'],
      name: 'react-dom/client'
    };
  }

  if (imports['react']) {
    imports['react/jsx-runtime'] = {
      ...imports['react'],
      name: 'react/jsx-runtime'
    };

    imports['react/jsx-dev-runtime'] = {
      ...imports['react'],
      name: 'react/jsx-dev-runtime'
    };
  }

  return imports;
}
