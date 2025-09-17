import path from "path";
import { serve } from "../../src/web";

async function* streamIndexPage() {
    yield `<div style="display: flex; flex-direction: column-reverse; font-size: 24px;">`;
    while (true) {
        yield `<span>
    ${new Date()}
    </span>
  `;
        await Bun.sleep(1000);
    }
}

serve((req: Request) => {
    return streamIndexPage();
});