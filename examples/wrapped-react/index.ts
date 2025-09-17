import path from 'path';
import { serve, frontendApp } from "../../src/web";

const { port } = serve(async (req: Request, measure) => {
  const url = new URL(req.url);
  
  if (url.pathname === '/') {
    try {
      return new Response(await frontendApp({
        entrypoint: path.join(__dirname, './App.client.tsx'),
        stylePath: path.join(__dirname, './App.css'),
        title: "Melina + React",
        viewport: "width=device-width, initial-scale=1.0",
        meta: [
          { name: "description", content: "A React app built with Melina framework" },
          { name: "author", content: "Melina Team" }
        ],
        rebuild: true,
        serverData: {
          message: "Hello from React with Melina!",
          timestamp: new Date().toISOString()
        }
      }), {
        headers: {
          'Content-Type': 'text/html',
          'Cache-Control': 'no-cache'
        }
      });
    } catch (error) {
      console.error('Frontend App Error:', error);
      return new Response(`<html><body><h1>Error: ${error.message}</h1></body></html>`, {
        headers: { 'Content-Type': 'text/html' }
      });
    }
  }
  
  // Add other routes or API endpoints here
  if (url.pathname === '/api/hello') {
    return Response.json({ message: "Hello from API" });
  }
  return new Response('Not Found', { status: 404 });
});

console.log("React example server running. Open http://localhost:" + port);
