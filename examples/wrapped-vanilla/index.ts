import path from 'path';
import { serve, frontendApp } from "../../src/web";

serve(async (req: Request) => {
  return new Response(await frontendApp({
    entrypoint: path.join(__dirname, './frontend.ts'),
    title: "Vanilla JS Example",
    meta: [
      { name: "description", content: "A vanilla JavaScript app with Melina" }
    ],
    serverData: {
      message: "Hello from Vanilla JS!",
      timestamp: new Date().toISOString()
    }
  }), {
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-cache'
    }
 });
});
