import { reactApp } from "./src/web";

async function testReactApp() {
  try {
    const html = await reactApp({
      entrypoint: './examples/react-tailwind/App.tsx',
      rebuild: true,
      serverData: {
        message: "Hello from React with Melina!",
        timestamp: new Date().toISOString()
      }
    });
    
    console.log("✅ reactApp test passed!");
    console.log("Generated HTML length:", html.length);
    console.log("Contains React:", html.includes("react"));
    console.log("Contains importmap:", html.includes("importmap"));
    console.log("Contains server data:", html.includes("SERVER_DATA"));
    
  } catch (error) {
    console.error("❌ reactApp test failed:", error);
  }
}

testReactApp();