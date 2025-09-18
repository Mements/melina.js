import path from "path";
import { serve, buildStyle, buildScript } from "../../src/web";

import { renderToReadableStream } from "react-dom/server";

const style = await buildStyle(path.join(__dirname, 'index.css'));
const scriptPath = await buildScript(path.join(__dirname, 'main.ts'), true);

function Component(props: { message: string }) {
  const importMap = JSON.stringify({
    imports: {
      "htmx.org": "https://unpkg.com/htmx.org@2.0.4/dist/htmx.esm.js"
    }
  });

  return (
    <html>
      <head>
        <script
          type="importmap"
          dangerouslySetInnerHTML={{ __html: importMap }}
        />
        <link rel="stylesheet" href={style} />
        <script src={scriptPath} type="module" defer></script>
      </head>
      <body>
        <div id="message">
          <span className="text-red-500 text-xl">{props.message}</span>
        </div>
        <button hx-get="/" hx-target="#message" hx-swap="innerHTML">Update Message</button>
      </body>
    </html>
  );
}

function MessageFragment() {
  return (
    <span className="text-red-500 text-xl">Updated message from HTMX!</span>
  );
}

serve(async (req) => {
  let stream;
  const isHtmxRequest = req.headers.get('hx-request') === 'true';

  if (isHtmxRequest) {
    stream = await renderToReadableStream(<MessageFragment />);
  } else {
    stream = await renderToReadableStream(<Component message="Hello from server!" />);
  }

  return new Response(stream, {
    headers: { "Content-Type": "text/html" },
  });
});
