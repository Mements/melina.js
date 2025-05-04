# Melina.js

A lightweight, streaming-first web framework for Bun that delivers blazing fast user experiences with zero configuration.

[![npm version](https://img.shields.io/npm/v/melinajs.svg)](https://www.npmjs.com/package/melinajs)
[![bun](https://img.shields.io/badge/powered%20by-bun-F7A41D)](https://bun.sh/)

## Features

  - 🚀 **Simplified Setup** - Define a server handler and start building.
  - 🌊 **Streaming by Default** - Return AsyncGenerators from your handler for immediate Time to First Contentful Paint.
  - 🧩 **Dynamic Import Maps** - Generate modern ES module import maps from your `package.json` on the fly.
  - ⚡ **On-Demand Asset Building** - Client-side JavaScript and CSS are built when requested during development, and cached in production.
  - 📏 **Framework Agnostic** - Works with React, Vue, Svelte, or vanilla JS on the client-side.
  - 📊 **Built-in Performance Measurement** - Debug and optimize with ease using the `measure` utility.
  - 🔥 **Tailwind CSS JIT** - Seamless Tailwind CSS integration for your assets.

## Installation

```bash
bun add melinajs
```

## Quick Start (React with Tailwind CSS Example)

This example demonstrates serving a React application with Tailwind CSS.

1.  **Install dependencies for the example:**

    ```bash
    bun add react react-dom react-client
    bun add -d @types/react @types/react-dom tailwindcss bun-plugin-tailwind
    ```

2.  **Create your React App Component (`App.tsx`):**

    ```tsx
    // ./App.tsx
    import React from 'react';

    // Make sure serverData is typed appropriately for your app
    // For this example, we expect { now: string }
    interface ServerData {
      now?: string;
      message?: string;
    }

    interface AppProps {
      serverData: ServerData;
    }

    const App: React.FC<AppProps> = ({ serverData }) => {
      return (
        <div className="p-4">
          <h1 className="text-2xl font-bold mb-2">Hello from Melina.js & React!</h1>
          <p className="text-lg">Data from server:</p>
          <pre className="bg-gray-100 p-3 rounded mt-1 text-sm">
            {JSON.stringify(serverData, null, 2)}
          </pre>
        </div>
      );
    };

    export default App;
    ```

3.  **Create a client-side entrypoint (`App.client.tsx`):**

    ```tsx
    // ./App.client.tsx
    import React from 'react';
    import { createRoot } from "react-dom/client";
    import App from './App';

    // Assuming SERVER_DATA is injected by your server-side stream
    declare global {
      interface Window {
        SERVER_DATA: any;
      }
    }

    const serverData = window.SERVER_DATA || { message: "No server data received" };

    // Optional: Remove a loading indicator if you have one
    // document.querySelector('#loading')!.remove();

    createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <App serverData={serverData} />
      </React.StrictMode>
    );
    ```

4.  **Create your Tailwind CSS entrypoint (`App.css`):**
    *(This file tells Bun's Tailwind plugin what to process)*

    ```css
    /* ./App.css */
    @import "tailwindcss" source("./"); /* Adjust source if your tailwind.config.js is elsewhere or includes other content paths */
    ```

    *Ensure your `tailwind.config.js` `content` array points to your `.tsx` files, e.g., `content: ["./*.{html,js,jsx,ts,tsx}"]`*

5.  **Create your server file (`server.ts`):**

    ```typescript
    // server.ts
    import path from "path";
    import { useServer, measure } from "melinajs"; // Assuming melinajs is in node_modules

    const { serve, asset, imports } = useServer();

    // Generate import maps for client-side dependencies from your package.json
    // For React, you'd typically need 'react', 'react-dom/client', and 'react/jsx-dev-runtime' (for dev)
    const generatedImportMaps = await measure(
      async () => imports(['react', 'react-dom/client', 'react/jsx-dev-runtime']),
      "Generate Import Maps"
    );

    const importMapScript = `
        <script type="importmap">
          ${JSON.stringify(generatedImportMaps, null, 2)}
        </script>
    `;

    async function* streamReactPage(req: Request) {
      const requestId = req.headers.get("X-Request-ID") || "unknown";
      yield `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Melina + React</title>
          ${importMapScript}
          <script src="${await asset(path.join(__dirname, 'App.client.tsx'))}" type="module" defer></script>
          <link rel="stylesheet" href="${await asset(path.join(__dirname, 'App.css'))}" />
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body>
          <div id="root">
            <div class="p-4 text-xl text-gray-500">Loading app...</div>
          </div>
      `;

      // Simulate some async data fetching
      const serverData = await measure(async () => {
        await Bun.sleep(50); // Simulate delay
        return {
          now: new Date().toISOString(),
          message: "Data fetched on the server!"
        };
      }, "Fetch Server Data", { requestId });

      yield `
          <script>
            window.SERVER_DATA = ${JSON.stringify(serverData)};
          </script>
        </body>
        </html>
      `;
    }

    serve(async (req: Request) => {
      const url = new URL(req.url);
      if (url.pathname === '/') {
        return streamReactPage(req);
      }
      // Add other routes or API endpoints here
      if (url.pathname === '/api/hello') {
        return Response.json({ message: "Hello from API" });
      }
      return new Response('Not Found', { status: 404 });
    });

    console.log("React example server running. Open http://localhost:3000");
    ```

6.  **Update `package.json` (ensure `type: "module"`):**
    Your `package.json` should look something like this:

    ```json
    {
      "name": "melina-react-example",
      "type": "module",
      "scripts": {
        "dev": "bun run server.ts",
        "start": "NODE_ENV=production bun run server.ts"
      },
      "dependencies": {
        "melinajs": "latest", // or specific version
        "react": "^18.2.0", // or ^19
        "react-dom": "^18.2.0", // or ^19
        "react-client": "latest" // or specific version for React 19
      },
      "devDependencies": {
        "@types/bun": "latest",
        "@types/react": "^18.2.0",
        "@types/react-dom": "^18.2.0",
        "bun-plugin-tailwind": "^0.0.15",
        "tailwindcss": "^3.3.0", // or latest
        "typescript": "^5.0.0"
      },
      "peerDependencies": {
        "typescript": "^5"
      }
    }
    ```

7.  **Start your server:**

    ```bash
    bun run dev
    ```

    Open `http://localhost:3000` (or your configured port) in your browser.

## Quick Start (Vanilla JS Streaming Example)

1.  **Create your server file (`server_vanilla.ts`):**

    ```typescript
    // server_vanilla.ts
    import { useServer } from "melinajs";

    const { serve } = useServer();

    async function* streamCounterPage() {
        yield `
          <!DOCTYPE html>
          <html>
          <head>
            <title>Melina Vanilla Stream</title>
            <meta charset="UTF-8">
            <style> body { font-family: sans-serif; display: flex; flex-direction: column-reverse; align-items: center; font-size: 24px; } </style>
          </head>
          <body>
            <p>Streaming server time:</p>
        `;
        let count = 0;
        while (true) {
            yield `<span>Tick ${++count}: ${new Date().toLocaleTimeString()}</span>`;
            await Bun.sleep(1000); // Stream a new chunk every second
            if (count > 10) { // Stop after 10 ticks for this example
              yield `<p>Done streaming.</p></body></html>`;
              break;
            }
        }
    }

    serve((req: Request) => {
        const url = new URL(req.url);
        if (url.pathname === '/vanilla') {
            return streamCounterPage();
        }
        return new Response('Not Found (try /vanilla)', { status: 404 });
    });

    console.log("Vanilla example server running. Open http://localhost:3000/vanilla");
    ```

2.  **Start your server:**

    ```bash
    bun run server_vanilla.ts
    ```

    Open `http://localhost:3000/vanilla` in your browser.

## How It Works

Melina.js simplifies web application delivery with a handler-centric approach:

1.  **Request Handling**: When a request comes in, it's routed to the main handler function you provide to `serve()`.
2.  **Server-Side Logic**: Your handler processes the request. You can implement routing, API endpoints, or page generation logic.
3.  **Streaming HTML**: For HTML pages, your handler can return an `AsyncGenerator<string>`. Melina immediately starts streaming the first chunk of HTML to the browser. This allows the browser to start parsing and rendering content without waiting for all server-side processing to complete.
4.  **Asset Serving**:
      * You use the `asset(filePath)` function within your server-side rendering logic (e.g., inside your streaming generator) to get a URL for a client-side JavaScript or CSS file.
      * **Development**: When a request for an asset URL comes, Melina (via Bun) builds that specific asset on-the-fly (e.g., transpiling TSX, processing CSS with Tailwind).
      * **Production**: Assets are built once and served with long-cache headers (hashed filenames ensure cache-busting).
5.  **Import Map Injection**: You can use the `imports([...dependencies])` function to generate an import map from your project's `package.json`. This import map is then manually injected into your HTML stream, allowing you to use bare module specifiers for your client-side ES modules (e.g., `import React from 'react'`).
6.  **Data Injection**: Server-side data can be injected into the HTML stream by embedding a `<script>` tag that assigns data to a global variable (e.g., `window.SERVER_DATA`). The client-side code can then pick this up.

This approach significantly improves perceived performance by prioritizing Time to First Contentful Paint (TTFCP) and enabling progressive rendering.

## `useServer()` API

The `useServer()` function is the primary way to interact with Melina.js.

```typescript
import { useServer } from "melinajs";

const { serve, asset, imports } = useServer();
```

  - **`serve(handler: (req: Request) => Response | AsyncGenerator<string> | Promise<...>)`**:
    Starts the Bun server with your main request handler.
    The handler receives the standard `Request` object and can return:

      * A `Response` object (e.g., `Response.json(...)`, `new Response(...)`).
      * An `AsyncGenerator<string>` for streaming HTML content.
      * A string (will be returned as `text/html`).
      * A plain object (will be returned as `application/json`).
      * A Promise that resolves to any of the above.

  - **`asset(filePath: string): Promise<string>`**:
    Takes a path to a client-side asset (e.g., `./App.client.tsx`, `./styles.css`).
    Returns a `Promise<string>` that resolves to a fingerprinted URL path (e.g., `/App.client-X1Y2Z3.js`) for that asset.
    In development, the asset is built on first request. In production, it's built once.
    Supports TypeScript/TSX, JavaScript, and CSS (with Tailwind JIT via `bun-plugin-tailwind` if `App.css` uses `@import "tailwindcss"`).

  - **`imports(subpaths?: string[], pkgJson?: any, lockFile?: any): Promise<ImportMap>`**:
    Generates an import map object.

      * `subpaths` (optional): An array of module subpaths to include (e.g., `['react-dom/client']`). Base packages from `dependencies` in `package.json` are included by default.
      * `pkgJson` (optional): Pass a pre-loaded `package.json` object. Defaults to loading `./package.json`.
      * `lockFile` (optional): Pass a pre-loaded `bun.lockb` (parsed as JSON) object. Defaults to loading `./bun.lockb`.
        It uses `esm.sh` as the CDN for ES modules and correctly resolves versions and peer dependencies based on your `package.json` and `bun.lockb`.

## API Routes

API routes are not specially configured. You implement them directly within your main `serve` handler by checking the `request.url` or `request.method`.

```typescript
// server.ts
// ... (setup useServer)

serve(async (req: Request) => {
  const url = new URL(req.url);

  if (url.pathname === '/api/users' && req.method === 'GET') {
    // Handle GET /api/users
    const users = [{ id: 1, name: "Ada" }, { id: 2, name: "Grace" }];
    return Response.json({ users });
  }

  if (url.pathname.startsWith('/api/users/') && req.method === 'POST') {
    // Handle POST /api/users/:id
    const body = await req.json();
    return Response.json({ message: "User created/updated", data: body }, { status: 201 });
  }

  // ... your HTML page routes
  if (url.pathname === '/') {
    // return streamMyPage();
  }

  return new Response("Not Found", { status: 404 });
});
```

## Performance Measurement

Melina includes a `measure` utility for tracking the performance of specific operations.

```typescript
import { measure } from "melinajs";

async function myOperation() {
  return await measure(
    async (nestedMeasure) => {
      // Your main code here
      await Bun.sleep(50);

      await nestedMeasure(
        async () => {
          // Nested operation
          await Bun.sleep(100);
        },
        "Database Query" // Name for this nested operation
      );

      return { result: "done" };
    },
    "My Main Operation", // Name for the overall operation
    { requestId: "optional-request-id", level: 0 } // Optional context
  );
}

myOperation().then(res => console.log("Result:", res));
```

This produces console output with timing information:

```
> My Main Operation...
==> Database Query...
=<< Database Query ✓ 100.25ms
< My Main Operation ✓ 150.80ms
Result: { result: 'done' }
```

## Import Maps Generation

Melina uses [Import Maps](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap) to manage client-side dependencies using modern ES modules without complex bundling for third-party libraries.

The `imports()` function, obtained from `useServer()`, automates this:

```typescript
import { useServer } from "melinajs";
// import packageJson from "./package.json"; // Optional: if you want to pass it explicitly

const { imports } = useServer();

// Example: Generate import map including react, react-dom/client, and others from package.json
const importMapObject = await imports(
  ['react', 'react-dom/client'] // Specify exact subpaths if needed
  // packageJson // Optionally pass your package.json object
);

// importMapObject will look like:
// {
//   "imports": {
//     "react": "https://esm.sh/react@18.2.0?dev",
//     "react-dom/client": "https://esm.sh/react-dom@18.2.0/client?dev",
//     // ... other dependencies from your package.json
//   }
// }

// Then, in your HTML streaming function:
// yield `<script type="importmap">${JSON.stringify(importMapObject, null, 2)}</script>`;
```

This automatically:

  - Extracts versions from your `package.json` (and `bun.lockb` for transitive/peer dependency resolution).
  - Configures CDN URLs (using `esm.sh` by default).
  - Handles peer dependencies correctly.
  - Appends `?dev` to CDN URLs in development for better debugging.

## FAQs

### Is Melina production-ready?

Yes\! When `NODE_ENV` is set to `production` (e.g., `NODE_ENV=production bun run server.ts`):

  - Assets built by `asset()` are cached with fingerprinted names for long-term browser caching.
  - JavaScript and CSS are minified.
  - Source maps are disabled for assets.
  - The `?dev` parameter is removed from `esm.sh` URLs in import maps.

### How does Melina compare to Next.js or Remix?

Melina is significantly more lightweight and takes a different philosophical approach:

  - **Minimal Build Step**: No complex global build step for your application. Assets are built on-demand by Bun.
  - **HTML Generation is Explicit**: You construct HTML, often via streaming, directly in your server-side TypeScript/JavaScript. There are no special file-system routing conventions for pages beyond what you implement in your handler.
  - **Handler-Centric**: All server logic (routing, API, page serving) typically resides in or is dispatched from the main handler function provided to `serve()`.
  - **Streaming-First by Design**: AsyncGenerators are a natural way to stream HTML.
  - **Leverages Bun's Strengths**: Built specifically for the Bun runtime, utilizing its speed, built-in TypeScript/JSX support, and asset building capabilities.
  - **Closer to the Platform**: Uses standard Web APIs like `Request`, `Response`, and leverages Import Maps for client-side modules.

Next.js and Remix are more feature-rich, opinionated frameworks with their own routing conventions, data-loading patterns, and extensive build systems. Melina offers a leaner, more direct way to build fast, streaming web applications on Bun.

### Can I use Melina with TypeScript?

Yes, Melina is built with TypeScript in mind and works seamlessly with it. Bun handles TypeScript transpilation automatically for your server code and any assets processed by `asset()`.

## Contributing

Contributions are welcome\! Please feel free to submit a Pull Request or open an issue.

## License

MIT