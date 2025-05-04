import path from "path";
import { useServer } from "../../index";

const { serve, asset, imports } = useServer();

const segmentImportMaps = `
    <script type="importmap">
      ${JSON.stringify(await imports(["react-dom/client", "react/jsx-dev-runtime"]), null, 2)}
    </script>
`;

async function* streamIndexPage() {
  yield `
        <head>
            ${segmentImportMaps}
            <script src="${await asset(path.join(__dirname, 'App.client.tsx'))}" type="module"></script>
            <link rel="stylesheet" href="${await asset(path.join(__dirname, 'App.css'))}" />
        </head>
        <div class="text-xl" id="loading">Loading...</div>
        <div id="root"></div>
    `;
  await Bun.sleep(1000);
  const serverData = { now: new Date() };
  yield `
        <body>
            <script>
                window.SERVER_DATA = ${JSON.stringify(serverData)};
            </script>
        </body>
    `;
}

serve((req: Request) => {
  if (new URL(req.url).pathname === '/') {
    return streamIndexPage();
  }
  return new Response('Not Found', { status: 404 });
});