import { serve, UriTemplate } from "../../src/mcp";
import { z } from "zod";

const httpServer = serve({
  // Define sample prompts
  prompts: [
    {
      name: 'greeting-template',
      description: 'A simple greeting prompt template',
      argsSchema: z.object({
        name: z.string().describe('Name to include in greeting'),
      }),
      callback: async ({ name }) => ({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please greet ${name} in a friendly manner.`,
            },
          },
        ],
      }),
      enabled: true,
    },
    {
      name: 'code-review',
      description: 'A template for code review',
      argsSchema: z.object({
        language: z.string().describe('Programming language'),
        code: z.string().describe('Code to review'),
      }),
      callback: async ({ language, code }) => ({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please review this ${language} code:\n\n${code}`,
            },
          },
        ],
      }),
      enabled: true,
    }
  ],

  // Define sample tools
  tools: [
    {
      name: 'get_weather',
      description: 'Get current weather information for a location',
      inputSchema: z.object({
        location: z.string().describe('City name or zip code')
      }),
      outputSchema: {
        type: "object",
        properties: {
          location: { type: "string" },
          temperature: { type: "number" },
          units: { type: "string", enum: ["celsius", "fahrenheit"] },
          conditions: { type: "string" },
          humidity: { type: "number" }
        },
        required: ["location", "temperature", "units", "conditions"]
      },
      callback: async ({ location }) => {
        // Mock weather data
        return {
          content: [
            {
              type: "text",
              text: `Current weather in ${location}:\nTemperature: 72°F\nConditions: Partly cloudy`,
            },
          ],
          structuredContent: {
            location: location,
            temperature: 72,
            units: "fahrenheit",
            conditions: "Partly cloudy",
            humidity: 45
          }
        };
      },
      enabled: true,
    }
  ],

  // Define sample resources
  resources: [
    {
      uri: 'https://example.com/documentation/overview',
      name: 'documentation-overview',
      mimeType: 'text/markdown',
      description: 'API Documentation Overview',
      readCallback: async () => ({
        contents: [
          {
            uri: 'https://example.com/documentation/overview',
            text: '# API Documentation\n\nThis is the overview of our API documentation.\n\n## Endpoints\n\n- `/api/users` - User management\n- `/api/products` - Product catalog\n- `/api/orders` - Order processing',
            mimeType: 'text/markdown'
          },
        ],
      }),
      enabled: true,
    }
  ],

  // Define resource templates
  resourceTemplates: [
    {
      name: 'user-profile',
      uriTemplate: new UriTemplate('https://example.com/users/{userId}'),
      mimeType: 'application/json',
      description: 'User profile information',
      readCallback: async (uri, variables) => {
        const userId = variables.userId;
        const userProfiles = {
          '1': { name: 'Alice Smith', email: 'alice@example.com', role: 'Admin' },
          '2': { name: 'Bob Johnson', email: 'bob@example.com', role: 'User' },
          '3': { name: 'Carol Williams', email: 'carol@example.com', role: 'Editor' },
        };

        const userData = userProfiles[userId] || { name: 'Unknown User', email: 'unknown@example.com', role: 'Guest' };

        return {
          contents: [
            {
              uri: uri.toString(),
              text: JSON.stringify(userData, null, 2),
              mimeType: 'application/json'
            },
          ],
        };
      },
      listCallback: async () => ({
        resources: [
          { uri: 'https://example.com/users/1', name: 'Alice Smith', mimeType: 'application/json' },
          { uri: 'https://example.com/users/2', name: 'Bob Johnson', mimeType: 'application/json' },
          { uri: 'https://example.com/users/3', name: 'Carol Williams', mimeType: 'application/json' },
        ]
      }),
      enabled: true,
    }
  ],

  // Optional: Specify port
  port: process.env.PORT ? parseInt(process.env.PORT) : 3000,
});

console.log(`MCP Server running at http://localhost:${httpServer.port}/mcp`);