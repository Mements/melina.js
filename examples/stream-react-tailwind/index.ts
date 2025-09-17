import path from "path";
import { measure } from "@ments/utils";
import { serve, buildScript, buildStyle, imports } from "../../src/web";

// 'important': all imports are generated automatically except those with subpath like react-dom/client we need to include manually
const importMapScript = `
    <script type="importmap">
      ${JSON.stringify(await imports(["react-dom/client", "react/jsx-dev-runtime"]), null, 2)}
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
      <script src="${await buildScript(path.join(__dirname, 'App.client.tsx'))}" type="module" defer></script>
      <link rel="stylesheet" href="${await buildStyle(path.join(__dirname, 'App.css'))}" />
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body>
      <div id="root">
        <div id="loading" class="p-4 text-xl text-gray-500">Loading app...</div>
      </div>
  `;

  const serverData = await measure(async () => {
    await Bun.sleep(500); // Simulate delay
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

const { port } = await serve(async (req: Request) => {
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

console.log("React example server running. Open http://localhost:" + port);
