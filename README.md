# Melina.js

A lightweight, streaming-first web framework for Bun that delivers blazing fast user experiences with zero configuration.

[![npm version](https://img.shields.io/npm/v/melinajs.svg)](https://www.npmjs.com/package/melinajs)
[![bun](https://img.shields.io/badge/powered%20by-bun-F7A41D)](https://bun.sh/)

## Features

  - **Simplified Setup** - Define a server handler and start building.
  - **Streaming by Default** - Return AsyncGenerators from your handler for immediate Time to First Contentful Paint.
  - **Dynamic Import Maps** - Generate modern ES module import maps from your `package.json` on the fly.
  - **On-Demand Asset Building** - Client-side JavaScript and CSS are built when requested during development, and cached in production.
  - **Framework Agnostic** - Works with React, Vue, Svelte, or vanilla JS on the client-side.
  - **Built-in Performance Measurement** - Debug and optimize with ease using the `measure` utility.
  - **Tailwind CSS JIT** - Seamless Tailwind CSS integration for your assets.
  - 🔥 **NEW: MCP Server** - MCP (Model Context Protocol)

## Installation

```bash
bun add melinajs
```

## Examples

Melina.js provides multiple architectural patterns for building web applications. Each example demonstrates different approaches to streaming, rendering, and performance optimization.

### 🔌 Streaming Examples (Real-time Updates with Loading States)

#### 1. Stream Vanilla (`examples/stream-vanilla/`)
**Pure streaming approach with real-time updates**

```typescript
async function* streamIndexPage() {
  yield `<div style="display: flex; flex-direction: column-reverse; font-size: 24px;">`;
  while (true) {
    yield `<span>${new Date()}</span>`;
    await Bun.sleep(1000);
  }
}
```

**Characteristics:**
- ✅ **Streaming HTML chunks** in real-time
- ✅ **Loading indicator** (built-in display of data)
- ✅ **Progressive rendering** - browser renders immediately
- ⚠️ **Manual HTML construction** - more complex setup
- ⚠️ **No asset building** - minimal features

**Use case:** Real-time dashboards, live data displays, progressive content loading

#### 2. Stream React Tailwind (`examples/stream-react-tailwind/`)
**Streaming with React and Tailwind CSS**

```typescript
async function* streamReactPage(req: Request) {
  // Initial HTML with loading state
  yield `<div id="root"><div id="loading" class="p-4 text-xl text-gray-500">Loading app...</div></div>`;
  
  // Fetch server data
  const serverData = await measure(async () => fetchServerData(), "Fetch Server Data");
  
  // Inject data and replace loading state
  yield `<script>window.SERVER_DATA = ${JSON.stringify(serverData)};</script>`;
}
```

**Characteristics:**
- ✅ **Streaming HTML with loading states**
- ✅ **React + Tailwind CSS support**
- ✅ **Manual import maps and asset building**
- ✅ **Progressive enhancement** - shows loading then content
- ✅ **Advanced streaming** with data fetching
- ⚠️ **Complex setup** - requires manual asset management
- ⚠️ **More boilerplate** for streaming React

**Use case:** Complex SPAs with loading states, progressive data loading, real-time updates

### 📦 Wrapped Examples (Simplified API, No Loading States)

#### 3. Wrapped Vanilla (`examples/wrapped-vanilla/`)
**Simplified API for vanilla JavaScript**

```typescript
return new Response(await frontendApp({
  entrypoint: path.join(__dirname, './frontend.ts'),
  title: "Vanilla JS Example",
  meta: [{ name: "description", content: "A vanilla JavaScript app with Melina" }],
  serverData: {
    message: "Hello from Vanilla JS!",
    timestamp: new Date().toISOString()
  }
}));
```

**Characteristics:**
- ✅ **Simple API** - single function call
- ✅ **Asset building** - automatic CSS/JS processing
- ✅ **Import maps** - automatic dependency management
- ✅ **Complete HTML generation** - no loading states
- ✅ **Minimal boilerplate**
- ⚠️ **No streaming** - generates complete HTML at once
- ⚠️ **No loading indicators** - content appears after full build

**Use case:** Simple vanilla JS apps, rapid prototyping, when streaming complexity isn't needed

#### 4. Wrapped React (`examples/wrapped-react/`)
**Simplified API for React with Tailwind CSS**

```typescript
return new Response(await frontendApp({
  entrypoint: path.join(__dirname, './App.client.tsx'),
  stylePath: path.join(__dirname, './App.css'),
  title: "Melina + React",
  viewport: "width=device-width, initial-scale=1.0",
  rebuild: true,
  serverData: {
    message: "Hello from React with Melina!",
    timestamp: new Date().toISOString()
  }
}));
```

**Characteristics:**
- ✅ **Very simple API** - minimal setup required
- ✅ **Full React + Tailwind CSS support**
- ✅ **Automatic asset building and optimization**
- ✅ **Complete HTML generation with server data**
- ✅ **Error handling built-in**
- ✅ **No streaming complexity**
- ⚠️ **No loading indicators** - waits for complete build
- ⚠️ **No real-time updates**

**Use case:** Traditional React apps, content-heavy pages, when simplicity is preferred over streaming

### Key Differences: Streaming vs Wrapped

#### Loading Indicators: Why the Difference?

**🔄 Streaming Examples (HAVE loading indicators):**
- **Manual HTML construction** - build initial HTML with loading states
- **Progressive rendering** - send partial HTML immediately, then update
- **Server data fetching** - fetch data separately and inject later
- **Real-time updates** - continuously stream new content
- **Example:** `stream-react-tailwind` shows "Loading app..." then replaces it with actual content

**📦 Wrapped Examples (NO loading indicators):**
- **Complete HTML generation** - build entire HTML at once
- **Asset building included** - process CSS/JS before sending response
- **Single response** - send complete HTML immediately
- **No intermediate states** - content appears after full build completes
- **Example:** `wrapped-react` waits for all assets and HTML generation before sending response

#### When to Use Each Pattern

**Choose Streaming when:**
- ✅ You need real-time updates (live data, chat, dashboards)
- ✅ You want progressive loading (show content as it's ready)
- ✅ You need loading states for better UX
- ✅ You're building SPAs with complex data fetching
- ⚠️ You're willing to handle more complexity

**Choose Wrapped when:**
- ✅ You want simplicity and fast development
- ✅ You don't need real-time updates
- ✅ You prefer traditional server-rendered HTML
- ✅ You want automatic asset handling
- ✅ You're building content-heavy pages
- ⚠️ You can accept loading time for complete rendering

## Quick Start

[MCP Example](./examples/mcp/server.ts)

[Web Example (Vanilla JS)](./examples/vanilla/index.ts)

[Web Example (React with Tailwind CSS)](./examples/react-tailwind/index.ts)

## How It Works (Web)

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

### API

```typescript
import { serve, asset, imports } from "melinajs/web";
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

```typescript
// server.ts
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