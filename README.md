# Melina.js

A lightweight, streaming-first web framework for Bun that delivers blazing fast user experiences with zero configuration.

[![npm version](https://img.shields.io/npm/v/melinajs.svg)](https://www.npmjs.com/package/melinajs)
[![bun](https://img.shields.io/badge/powered%20by-bun-F7A41D)](https://bun.sh/)

## Features

- 🚀 **Zero config setup** - Just define HTML pages and start building
- 🌊 **Streaming by default** - Immediate Time to First Contentful Paint
- 🧩 **Import Maps** - Modern ES modules with automatic versioning
- 🔄 **Instant HMR** - Pages are compiled on each request during development
- 📏 **Framework agnostic** - Works with React, Vue, Svelte, or vanilla JS
- 📊 **Built-in performance measurement** - Debug and optimize with ease

## Installation

```bash
bun add melinajs
```

## Quick Start

1. Create a simple HTML page:

```html
<!-- pages/index.html -->
<!DOCTYPE html>
<html>
<head>
  <title>My Melina App</title>
</head>
<body>
  <div id="root"></div>
  <script type="module">
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    
    function App() {
      // Access server data automatically injected by Melina
      const data = window.serverData || {};
      
      return (
        <div className="p-4">
          <h1 className="text-2xl font-bold">Hello, {data.name || 'World'}!</h1>
        </div>
      );
    }
    
    createRoot(document.getElementById('root')).render(<App />);
  </script>
</body>
</html>
```

2. Create your server file:

```javascript
// server.js
import { serve, generateImports } from "melina";
import packageJson from "./package.json";

await serve({
  pages: [
    {
      route: "/",
      target: "./pages/index.html",
      handler: async ({ requestId, measure }) => {
        // Data returned here gets streamed to the client
        return {
          name: "Melina",
          timestamp: Date.now()
        };
      }
    }
  ],
  // Import map is automatically generated from your package.json
  imports: generateImports(packageJson)
});
```

3. Start your server:

```bash
bun run server.js
```

## How It Works

Melina.js takes a unique approach to web application delivery:

1. **Initial HTML Streaming**: When a request comes in, Melina immediately begins streaming the HTML response to the browser
   
2. **Page Modifications**: During this process, Melina:
   - Replaces source paths pointing to transpiled file bundles
   - Injects Import Maps at the start of the `<head>`
   - Prepares to inject Server Data at the end of the `<body>`

3. **Parallel Server Data**: While the HTML is streaming, your handler function runs in parallel to prepare any necessary data

4. **Second Chunk**: Once your handler completes, Melina sends the server data as a second chunk of the same response

This approach dramatically improves perceived performance as the browser can start parsing and loading resources immediately without waiting for server data to be prepared.

## Configuration

### Page Configuration

```javascript
{
  route: "/about",              // URL path for this page
  target: "./pages/about.html", // Path to the HTML file
  handler: async (ctx) => {     // Optional data handler
    // Return data to be injected as window.serverData
    return { ... };
  }
}
```

### Handler Context

The handler function receives a context object with:

```javascript
{
  request: Request,         // Original request object
  method: string,           // Request method (GET, POST, etc.)
  path: string,             // Request path
  query: Record<string, string | number | boolean>, // Query parameters
  body?: any,               // Request body (if applicable)
  headers: Headers,         // Request headers
  requestId: string,        // Unique request ID
  measure: MeasureFn        // Performance measurement utility
}
```

### API Routes

```javascript
await serve({
  // Pages configuration
  pages: [...],
  
  // API endpoints
  api: {
    "/api/users": async (req) => {
      // Handle API request
      return Response.json({ users: [...] });
    }
  },
  
  // Imports configuration
  imports: {...}
});
```

## Performance Measurement

Melina includes a powerful `measure` utility for tracking performance:

```javascript
import { measure } from "melina";

await measure(
  async (nestedMeasure) => {
    // Your code here
    
    await nestedMeasure(
      async () => {
        // Nested operation
      },
      "Nested operation name"
    );
    
    return result;
  },
  "Operation name",
  { level: 0 } // Optional context
);
```

This produces beautiful console output with timing information:

```
> Operation name...
==> Nested operation name...
=<< Nested operation name ✓ 42.53ms
< Operation name ✓ 105.21ms
```

## Import Maps

Melina uses [Import Maps](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap) to manage dependencies. You can manually configure them or use the `generateImports` helper:

```javascript
import { generateImports } from "melina";
import packageJson from "./package.json";

const imports = generateImports(packageJson);
```

This automatically:
- Extracts versions from your package.json
- Configures CDN URLs (using esm.sh)
- Handles peer dependencies correctly
- Supports development/production modes

## FAQs

### Is Melina production-ready?

Yes! In production mode, Melina optimizes performance by:
- Caching compiled pages
- Enabling long-term caching for static assets
- Minifying JavaScript and CSS
- Disabling source maps

### How does Melina compare to Next.js or Remix?

Melina is more lightweight and has a different philosophy:
- No build step required
- Pages are just regular HTML files
- No routing conventions to learn
- Streaming-first approach by default
- Works directly with ES modules and Import Maps

### Can I use Melina with TypeScript?

Yes, Melina works great with TypeScript. Just use `.ts` or `.tsx` files and Bun will handle the rest.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT
