import path from "path";
import { serve, buildStyle } from "../../src/web";

import { renderToReadableStream } from "react-dom/server";

const style = await buildStyle(path.join(__dirname, 'index.css'));

function Component(props: { message: string }) {
  return (
    <html>
      <head>
        <link rel="stylesheet" href={style}></link>
      </head>
      <body>
        <span className="text-red-500 text-xl">{props.message}</span>
      </body>
    </html>
  );
}

serve(async (req) => {
  const stream = await renderToReadableStream(
    <Component message="Hello from server!" />,
  );

  return new Response(stream, {
    headers: { "Content-Type": "text/html" },
  });
})
