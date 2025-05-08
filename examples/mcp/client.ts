// Simple MCP client for testing
import { randomUUID } from "crypto";

const SERVER_URL = "http://localhost:3000/mcp";

// Helper function to send MCP requests
async function sendRequest(method: string, params?: any) {
  const id = `client-${randomUUID().slice(0, 8)}`;
  const request = {
    jsonrpc: "2.0",
    id,
    method,
    params
  };
  
  console.log(`Sending request: ${JSON.stringify(request, null, 2)}`);
  
  const response = await fetch(SERVER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify(request)
  });
  
  if (!response.ok) {
    throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
  }
  
  if (response.status === 202) {
    console.log("Server accepted notification (202)");
    return null;
  }
  
  const data = await response.json();
  console.log(`Received response: ${JSON.stringify(data, null, 2)}`);
  return data.result;
}

// Helper function to send MCP notifications
async function sendNotification(method: string, params?: any) {
  const notification = {
    jsonrpc: "2.0",
    method,
    params
  };
  
  console.log(`Sending notification: ${JSON.stringify(notification, null, 2)}`);
  
  const response = await fetch(SERVER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify(notification)
  });
  
  if (!response.ok) {
    throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
  }
  
  console.log(`Notification accepted (${response.status})`);
}

// Run a test sequence
async function runTest() {
  try {
    // Initialize
    console.log("--- Initializing MCP connection ---");
    const initResult = await sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "MCPExampleClient",
        version: "1.0.0"
      }
    });
    
    console.log("--- Sending initialized notification ---");
    await sendNotification("notifications/initialized");
    
    // List tools
    console.log("\n--- Listing available tools ---");
    const toolsResult = await sendRequest("tools/list");
    
    // Call a tool
    console.log("\n--- Calling weather tool ---");
    const toolResult = await sendRequest("tools/call", {
      name: "get_weather",
      arguments: {
        location: "San Francisco"
      }
    });
    
    // List prompts
    console.log("\n--- Listing available prompts ---");
    const promptsResult = await sendRequest("prompts/list");
    
    // Get a prompt
    console.log("\n--- Getting greeting prompt ---");
    const promptResult = await sendRequest("prompts/get", {
      name: "greeting-template",
      arguments: {
        name: "Claude"
      }
    });
    
    // List resources
    console.log("\n--- Listing available resources ---");
    const resourcesResult = await sendRequest("resources/list");
    
    // Read a resource
    console.log("\n--- Reading a resource ---");
    const resourceResult = await sendRequest("resources/read", {
      uri: "https://example.com/documentation/overview"
    });
    
    // Read a template resource
    console.log("\n--- Reading a template resource ---");
    const templateResourceResult = await sendRequest("resources/read", {
      uri: "https://example.com/users/1"
    });
    
    console.log("\n--- Test completed successfully ---");
  } catch (error) {
    console.error("Test failed:", error);
  }
}

// Run the test
runTest();