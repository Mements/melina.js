# melina.js

A lightweight, type-safe server framework for Bun with automatic performance tracking, server-side data injection, and simplified frontend dependency management.

## Features

-   **Flexible Page Routing**: Serve HTML pages from any location.
-   **Type-Safe API Routes**: Build backend endpoints with TypeScript validation (using external libraries like Zod recommended).
-   **Server-Side Data Injection**: Seamlessly pass data from server handlers to your frontend code.
-   **Automatic Import Map Generation**: Manages frontend dependencies via ESM.sh based on `package.json`.
-   **Performance Tracking**: Built-in nested performance monitoring with request IDs and clear logging.
-   **Development Ready**: Fast rebuilds (in dev mode) for quick iterations.
-   **Static Assets**: Serve static files easily from a dedicated `assets` directory.
-   **Dependency Analysis**: Automatic `package.json` parsing for import generation.

## Installation

```bash
bun add melinajs

# Or using npm/yarn
npm install melinajs
yarn add melinajs
```

## Quick Start

Follow these steps to create a simple application:

**1. Create Project Structure**

Set up your directories and files:

```
your-project/
├── assets/              # Static files (images, fonts, etc.)
│   └── favicon.ico
├── pages/               # Source code for your pages
│   ├── index/           # Example: Folder for the index page
│   │   ├── App.html     # The HTML entry point for the route '/'
│   │   └── App.client.tsx # Client-side script referenced in App.html
│   └── about/
│       ├── About.html
│       └── About.client.js
├── dist/                # Build output (auto-generated)
├── server.ts            # Your Melina server setup file
├── package.json
└── tsconfig.json
```

**2. Create an HTML Page (`./pages/index/App.html`)**

This is the main HTML file that Melina will serve and enhance.

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>App | Powered by Melina & Bun</title>
    <!-- Link CSS if needed (will be built by Bun) -->
    <!-- <link rel="stylesheet" href="./App.css" /> -->
    <link rel="icon" type="image/x-icon" href="/favicon.ico" />
  </head>
  <body>
    <!-- Container for your client-side app -->
    <div id="root"></div>

    <!--
      Import your client-side entry point.
      Melina/Bun build handles TSX/JS/TS compilation.
      The import map injected by Melina allows using bare specifiers (e.g., 'react').
    -->
    <script src="./App.client.tsx" type="module"></script>
  </body>
</html>
```

**3. Create a Client-Side Script (`./pages/index/App.client.tsx`)**

This is where your frontend JavaScript/React code lives.

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';

// Access data injected by the server handler
// `window.serverData` is added automatically by Melina if a handler returns data.
const serverData = window.serverData || { message: "No server data found.", initialCount: 0 };

function App() {
  const [count, setCount] = React.useState(serverData.initialCount);

  return (
    <div>
      <h1>{serverData.message}</h1>
      <p>Request ID: {serverData.requestId}</p> {/* Melina also injects requestId */}
      <p>Client Counter: {count}</p>
      <button onClick={() => setCount(c => c + 1)}>Increment</button>
      <p><a href="/about">Go to About</a></p>
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
} else {
  console.error("Could not find root element to mount React app.");
}

// Log server data for debugging
console.log("Server Data Received:", serverData);
```

**4. Create the Server (`server.ts`)**

Configure and run your Melina server.

```ts
import { serve, generateImports } from "melinajs";

// Import package.json using Bun's syntax
// Make sure './package.json' is the correct relative path
import packageJsonData from "./package.json" with { type: "json" };
const packageJson = packageJsonData.default; // Bun wraps JSON in { default: ... }

// Optional: Define API types (example)
type User = { id: number; name: string; role: string };
type Stats = { period: string; visitors: number; conversions: number };

// Generate imports from package.json (recommended)
// Pass null for lockfile as JS parsing of bun.lockb is not yet standard
const autoImports = generateImports(packageJson, null);

// Create and run the server
serve({
  // Define pages: map routes to HTML targets and optional data handlers
  pages: [
    {
      route: '/',
      // Point target to your HTML file
      target: './pages/index/App.html',
      // Handler runs on the server before the page is sent
      handler: async (ctx) => {
        // Performance for this block is automatically measured
        const dynamicMessage = `Data from server for ${ctx.path}`;
        const randomStart = await ctx.measure(
             async () => Math.floor(Math.random() * 100),
             "Generate random start value"
        );

        // Data returned here is injected as `window.serverData`
        return {
          message: dynamicMessage,
          initialCount: randomStart,
          timestamp: new Date().toISOString(),
        };
      },
    },
    {
        route: '/about',
        target: './pages/about/About.html' // Page without a server data handler
    }
  ],

  // Define type-safe API endpoints
  api: {
    '/api/users': async (req): Promise<Response> => {
      const users: User[] = [
        { id: 1, name: 'Jane Doe', role: 'Admin' },
        { id: 2, name: 'John Smith', role: 'Editor' }
      ];
      return new Response(JSON.stringify(users), {
        headers: { "Content-Type": "application/json" },
      });
    },
    '/api/stats': async (req): Promise<Response> => {
      const url = new URL(req.url);
      const period = url.searchParams.get('period') || 'week';
      const stats: Stats = { period, visitors: 1024, conversions: 89 };
      return new Response(JSON.stringify(stats), {
        headers: { "Content-Type": "application/json" },
      });
    }
  },

  // Frontend dependencies (use generated or define manually as a Record)
  imports: {
    ...autoImports, // Spread generated imports
    // Add or override manually if needed:
    'zustand': { name: 'zustand', version: '4.5.0' }
    // Example manual definition (if not using generateImports):
    // 'react': { name: 'react', version: '18.2.0' },
    // 'react-dom/client': { name: 'react-dom/client', version: '18.2.0', deps: ['react'] },
    // 'react/jsx-runtime': { name: 'react/jsx-runtime', version: '18.2.0', deps: ['react'] },
  },
});

console.log("Melina server setup complete. Starting...");
```

**5. Add Dependencies (`package.json`)**

Ensure you have the necessary dependencies, especially if using React.

```json
{
  "name": "your-project",
  "module": "server.ts",
  "type": "module",
  "scripts": {
    "start": "bun run server.ts",
    "dev": "bun --watch run server.ts"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "bun-types": "latest",
    "typescript": "^5.0.0"
  },
  "dependencies": {
    "melinajs": "latest", // Or the specific version you installed
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
    // Add other dependencies like zustand if used
  }
}
```

**6. Run the Server**

```bash
# For development with hot-reloading (rebuilds on request)
bun run dev

# For production (uses initial build artifacts)
NODE_ENV=production bun run start
```

Now, visit `http://localhost:3000` (or the port Bun chooses) in your browser!

## Core Concepts

### Page Routing and Serving

-   `serve({ pages: [...] })`: Define your application's routes.
-   `route`: The URL path (e.g., `/`, `/dashboard`).
-   `target`: The **relative path** to the **HTML file** that serves as the entry point for this route (e.g., `./pages/dashboard/App.html`). Melina resolves this path and uses it for building and serving.
-   `handler`: An optional `async` function that runs **on the server** for each request to this route. It receives a context object (`ctx`) and its return value is injected into the page's HTML as `window.serverData`.

### Server-Side Data Injection

Pass data from your server handler directly to your client-side code:

```ts
// Server-side handler in server.ts
{
  route: '/dashboard',
  target: './pages/dashboard/Dashboard.html',
  handler: async (ctx) => {
    const userId = ctx.query.userId || 'guest';
    const userData = await ctx.measure( // Performance tracking included!
        async () => fetchUserDataFromDB(userId),
        "Fetch User Data"
    );
    // This object becomes window.serverData in the browser
    return {
      user: userData,
      permissions: ['read', 'write'],
      lastLogin: new Date().toISOString()
    };
  }
}

// Client-side script (e.g., ./pages/dashboard/Dashboard.client.tsx)
import React from 'react';
// ... other imports

// Access the data injected by Melina
const serverData = window.serverData;

function Dashboard() {
  if (!serverData || !serverData.user) {
    return <div>Loading or Error...</div>;
  }

  return (
    <div>
      <h1>Welcome, {serverData.user.name}</h1>
      <p>Last login: {new Date(serverData.lastLogin).toLocaleString()}</p>
      <p>Permissions: {serverData.permissions.join(', ')}</p>
      {/* Use serverData to initialize state, render components, etc. */}
    </div>
  );
}
// ... render the App
```

### Performance Tracking (`measure` and `ctx.measure`)

Melina automatically wraps requests and server data handlers with performance measurement. You can add detailed tracking to your own asynchronous operations using the `measure` function (available globally or via `ctx.measure` in handlers).

```ts
// Inside a page handler or API handler
handler: async (ctx) => {
  const results = await ctx.measure(
    async (measure) => { // Use the nested measure function passed in
      const step1Data = await measure(
         async () => apiCall1(),
         "Call External API 1" // Action description
      );
      const step2Data = await measure(
         async () => processData(step1Data),
         "Process API 1 Data"
      );
      return { step1Data, step2Data };
    },
    "Fetch and Process User Flow", // Top-level action description
    // Context (like requestId) is automatically passed down
  );
  return { /* some data */ };
}

// Console output:
// [abc123] > Fetch and Process User Flow...
// [abc123] =>> Call External API 1...
// [abc123] =<< Call External API 1 ✓ 150.32ms
// [abc123] =>> Process API 1 Data...
// [abc123] =<< Process API 1 Data ✓ 35.10ms
// [abc123] < Fetch and Process User Flow ✓ 188.45ms
```

Features:
-   Automatic Request IDs (`ctx.requestId`).
-   Nested timing with clear start (`>`) / end (`<`) / success (`✓`) / failure (`✗`) logs.
-   Indentation shows nesting level.
-   Accurate duration measurement for async operations.

### Import Management (`imports` and `generateImports`)

Melina uses an **import map** injected into your HTML `<head>` to resolve frontend dependencies via [esm.sh](https://esm.sh/).

**1. Automatic Generation (Recommended)**

Use `generateImports` to analyze your `package.json`:

```ts
import { serve, generateImports } from "melinajs";
import packageJsonData from "./package.json" with { type: "json" };
const packageJson = packageJsonData.default;

// Generates a Record<string, ImportConfig>
const autoImports = generateImports(packageJson, null /* bun.lockb parsing TBD */);

serve({
  // ... pages, api ...
  imports: {
      ...autoImports, // Spread the generated map
      // Optionally add/override entries
      'my-custom-lib': { name: 'my-custom-lib', version: '1.0.0' }
  }
});
```

`generateImports` automatically handles common cases like `react`, `react-dom/client`, and JSX runtimes.

**2. Manual Definition**

Define imports explicitly as a `Record<string, ImportConfig>`:

```ts
serve({
  // ... pages, api ...
  imports: {
    // Key: The specifier used in `import` statements (e.g., 'react')
    'react': {
      name: 'react',        // Package name on npm/esm.sh
      version: '18.2.0'     // Specify version
    },
    'react-dom/client': {
      name: 'react-dom/client', // Subpath import
      version: '18.2.0',
      deps: ['react']       // Declare peer dependencies (uses versions from map)
    },
    'react/jsx-runtime': {
      name: 'react/jsx-runtime',
      version: '18.2.0',
      deps: ['react']
    },
    '@chakra-ui/react': {   // Scoped package example
      name: '@chakra-ui/react',
      version: '2.5.1',
      deps: ['react', '@emotion/react', '@emotion/styled', 'framer-motion'] // List peer deps by name
    },
    'lodash-es': {          // Library without default export
       name: 'lodash-es',
       version: '4.17.21'
    },
    'lodash-es/get': {      // Deep import
       name: 'lodash-es/get',
       version: '4.17.21' // Version comes from base 'lodash-es' if not specified here
    }
  }
});
```

### Static Assets

Place static files (images, fonts, `favicon.ico`, etc.) in the `./assets` directory. Melina will serve them directly.

-   Request to `/favicon.ico` serves `./assets/favicon.ico`.
-   Request to `/images/logo.png` serves `./assets/images/logo.png`.

### Handler Context (`ctx`)

Page handlers (`handler: async (ctx) => {...}`) receive a context object with useful properties:

```ts
async function myPageHandler(ctx) {
  // Request Info
  const method = ctx.method; // 'GET', 'POST', etc.
  const path = ctx.path;     // Requested path (e.g., '/dashboard')
  const query = ctx.query;   // Parsed query string object (e.g., { userId: '123' })
  const headers = ctx.headers; // Request headers object
  const body = ctx.body;     // Parsed JSON body for POST/PUT etc. (or {} if parsing fails)
  const request = ctx.request; // The original Request object

  // Melina Features
  const requestId = ctx.requestId; // Unique ID for this request
  const measure = ctx.measure;   // Nested performance measurement function

  // Example Usage
  console.log(`[${requestId}] Handling ${method} ${path}`);

  if (method === 'POST' && body) {
    await measure(async () => processFormData(body), "Process Form Data");
  }

  const userData = await measure(async () => fetchUser(query.id), "Fetch User");

  // Return data to inject into the page
  return { user: userData };
}
```

### API Routes (`api`)

Define backend API endpoints separately from pages. These handlers receive the raw `Request` object and should return a `Response` object.

```ts
serve({
  // ... pages, imports ...
  api: {
    '/api/health': async (req: Request): Promise<Response> => {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    },
    '/api/items': async (req: Request): Promise<Response> => {
      if (req.method === 'POST') {
        try {
          const newItem = await req.json();
          const createdItem = await db.createItem(newItem);
          return new Response(JSON.stringify(createdItem), { status: 201 });
        } catch (e) {
          return new Response('Invalid JSON', { status: 400 });
        }
      }
      // Handle GET, etc.
      const items = await db.getItems();
      return new Response(JSON.stringify(items));
    }
  }
});
```

## How It Works (Simplified)

```mermaid
graph TD
    A[Browser Request] --> B{Melina Server (Bun)}
    B --> C{Match Route?}
    C -->|API Route| G[Execute API Handler]
    C -->|Page Route| F{Execute Page Handler (if exists)}
    C -->|Static Asset Path| D[Serve from ./assets]
    C -->|Built Asset Path| E[Serve from ./dist]
    C -->|Not Found| Z[Return 404]

    F --> H[Get Server Data]
    H --> I{Dev or Prod?}
    I -->|Dev Mode| J[Rebuild Page (HTML + Client Script)]
    I -->|Prod Mode| K[Get Path from Build Cache]

    J --> L[Built HTML Path]
    K --> L

    L --> M[Read Built HTML File]
    M --> N[Inject Import Map (Head)]
    M --> O[Inject serverData (Body)]
    O --> P[Stream Response to Browser]

    G --> Q[Return API Response]
    D --> P
    E --> P
    Q --> P
    Z --> P
```

## Development vs. Production

-   **Development (`bun run dev` or `bun --watch server.ts`):**
    -   Pages are rebuilt by `bun build` on *every request*.
    -   Source maps are generated (`sourcemap: "linked"`).
    -   More verbose logging.
    -   Uses `?dev` flag with esm.sh for better debugging.
-   **Production (`NODE_ENV=production bun server.ts`):**
    -   An initial `bun build` creates optimized assets in `./dist`.
    -   Server serves pre-built files from `./dist` or the cache. No per-request builds.
    -   Minification is enabled.
    -   Source maps are typically disabled.
    -   Cache headers are set for assets.

## License

MIT