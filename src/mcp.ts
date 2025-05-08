import { z } from "zod";
import { randomUUID } from "crypto";
import type { Server } from "bun";

// Function to convert Zod schema to JSON Schema
function zodToJsonSchema(schema: z.ZodType<any, any, any>): any {
  const getDescription = (schema: any): string | undefined => {
    if (!schema._def?.metadata) return undefined;
    const desc = schema._def.metadata.find((m: any) => 
      typeof m === 'object' && m !== null && 'description' in m
    );
    return desc?.description;
  };

  if (schema instanceof z.ZodObject) {
    const shape = schema._def.shape();
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const key in shape) {
      const field = shape[key];
      properties[key] = zodToJsonSchema(field);
      if (!(field instanceof z.ZodOptional)) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
      ...(getDescription(schema) ? { description: getDescription(schema) } : {})
    };
  } else if (schema instanceof z.ZodString) {
    return { 
      type: "string", 
      ...(getDescription(schema) ? { description: getDescription(schema) } : {}) 
    };
  } else if (schema instanceof z.ZodNumber) {
    return { 
      type: "number", 
      ...(getDescription(schema) ? { description: getDescription(schema) } : {}) 
    };
  } else if (schema instanceof z.ZodBoolean) {
    return { 
      type: "boolean", 
      ...(getDescription(schema) ? { description: getDescription(schema) } : {}) 
    };
  } else if (schema instanceof z.ZodArray) {
    return {
      type: "array",
      items: zodToJsonSchema(schema._def.type),
      ...(getDescription(schema) ? { description: getDescription(schema) } : {})
    };
  } else if (schema instanceof z.ZodOptional) {
    return zodToJsonSchema(schema._def.innerType);
  } else if (schema instanceof z.ZodEnum) {
    return {
      type: "string",
      enum: schema._def.values,
      ...(getDescription(schema) ? { description: getDescription(schema) } : {})
    };
  }
  return { type: "object" };
}

// Type definitions for MCP messages
type JSONRPCId = string | number;

interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: JSONRPCId;
  method: string;
  params?: Record<string, any>;
}

interface JSONRPCNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, any>;
}

interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: JSONRPCId;
  result: any;
}

interface JSONRPCError {
  jsonrpc: "2.0";
  id: JSONRPCId | null;
  error: {
    code: number;
    message: string;
    data?: any;
  };
}

type JSONRPCMessage = JSONRPCRequest | JSONRPCNotification | JSONRPCResponse | JSONRPCError;

// Type definitions for MCP content types
interface TextContent {
  type: "text";
  text: string;
}

interface ImageContent {
  type: "image";
  data: string; // base64
  mimeType: string;
}

interface AudioContent {
  type: "audio";
  data: string; // base64
  mimeType: string;
}

interface ResourceContent {
  type: "resource";
  resource: {
    uri: string;
    mimeType: string;
    text?: string;
    blob?: string; // base64
  };
}

type Content = TextContent | ImageContent | AudioContent | ResourceContent;

interface PromptMessage {
  role: "user" | "assistant";
  content: Content;
}

// MCP Primitives interfaces
interface Tool {
  name: string;
  description?: string;
  inputSchema?: any;
  outputSchema?: any;
  annotations?: Record<string, any>;
  callback: (args: any) => Promise<CallToolResult>;
  enabled: boolean;
}

interface Prompt {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
  argsSchema?: z.ZodObject<any>;
  callback: (args: any) => Promise<GetPromptResult>;
  enabled: boolean;
}

interface Resource {
  uri: string;
  name: string;
  mimeType?: string;
  description?: string;
  size?: number;
  readCallback: (uri: URL) => Promise<ReadResourceResult>;
  enabled: boolean;
}

export class UriTemplate {
  private template: string;
  private variableNames: string[];
  private pattern: RegExp;

  constructor(template: string) {
    this.template = template;
    this.variableNames = this.extractVariableNames(template);
    this.pattern = this.buildMatchPattern(template);
  }

  toString(): string {
    return this.template;
  }

  match(uri: string): Record<string, string> | null {
    const match = uri.match(this.pattern);
    if (!match) return null;

    const result: Record<string, string> = {};
    for (let i = 0; i < this.variableNames.length; i++) {
      result[this.variableNames[i]] = match[i + 1];
    }
    return result;
  }

  private extractVariableNames(template: string): string[] {
    const variableRegex = /{([^}]+)}/g;
    const matches = template.match(variableRegex) || [];
    return matches.map(match => match.slice(1, -1));
  }

  private buildMatchPattern(template: string): RegExp {
    const patternString = template.replace(/{([^}]+)}/g, '([^/]+)');
    return new RegExp(`^${patternString}$`);
  }

  fill(variables: Record<string, string>): string {
    let result = this.template;
    for (const name in variables) {
      const value = encodeURIComponent(variables[name]);
      result = result.replace(new RegExp(`{${name}}`, 'g'), value);
    }
    return result;
  }
}

interface ResourceTemplate {
  name: string;
  uriTemplate: UriTemplate;
  mimeType?: string;
  description?: string;
  readCallback: (uri: URL, variables: Record<string, string>) => Promise<ReadResourceResult>;
  listCallback?: () => Promise<ListResourcesResult>;
  enabled: boolean;
}

// MCP Result interfaces
interface CallToolResult {
  content: Content[];
  isError?: boolean;
  structuredContent?: Record<string, any>;
}

interface GetPromptResult {
  description?: string;
  messages: PromptMessage[];
}

interface ReadResourceResult {
  contents: Array<{
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  }>;
}

interface ListResourcesResult {
  resources: Array<{
    uri: string;
    name: string;
    mimeType?: string;
    description?: string;
    size?: number;
  }>;
  nextCursor?: string;
}

// MCP Server configuration
interface MCPConfig {
  tools?: Tool[];
  prompts?: Prompt[];
  resources?: Resource[];
  resourceTemplates?: ResourceTemplate[];
}

interface ServeOptions {
  port?: number;
  fetch?: (req: Request) => Promise<Response>;
}

// Performance measurement utility
async function measure<T>(
  fn: () => Promise<T>,
  action: string,
  context: {
    requestId?: string;
    level?: number;
  } = {}
): Promise<T> {
  const start = performance.now();
  const level = context.level || 0;
  const indent = "=".repeat(level > 0 ? level + 1 : 0);
  const requestId = context.requestId || randomUUID().slice(0, 8);
  const logPrefixStart = requestId ? `[${requestId}] ${indent}>` : `${indent}>`;
  const logPrefixEnd = requestId ? `[${requestId}] ${indent}<` : `${indent}<`;

  try {
    console.log(`${logPrefixStart} ${action}...`);
    const result = await fn();
    const duration = performance.now() - start;
    console.log(`${logPrefixEnd} ${action} ✓ ${duration.toFixed(2)}ms`);
    return result;
  } catch (error) {
    const duration = performance.now() - start;
    console.log(`${logPrefixEnd} ${action} ✗ ${duration.toFixed(2)}ms`);
    if (error instanceof Error) {
      console.error(`Error in action "${action}":`, error.message);
      if (error.stack) console.error(error.stack);
    } else {
      console.error(`Unknown error in action "${action}":`, error);
    }
    throw error;
  }
}

// Main serve function
export function serve(config: MCPConfig & ServeOptions = {}): Server {
  const { tools = [], prompts = [], resources = [], resourceTemplates = [], port = 3000, fetch } = config;

  // Maps for quick lookups
  const toolMap = new Map<string, Tool>();
  const promptMap = new Map<string, Prompt>();
  const resourceMap = new Map<string, Resource>();
  const resourceTemplateMap = new Map<string, ResourceTemplate>();

  tools.forEach(tool => toolMap.set(tool.name, tool));
  prompts.forEach(prompt => promptMap.set(prompt.name, prompt));
  resources.forEach(resource => resourceMap.set(resource.uri, resource));
  resourceTemplates.forEach(template => resourceTemplateMap.set(template.name, template));

  // Server capabilities
  const capabilities = {
    tools: { listChanged: tools.length > 0 },
    prompts: { listChanged: prompts.length > 0 },
    resources: { 
      listChanged: resources.length > 0 || resourceTemplates.length > 0,
      subscribe: false
    },
    logging: {}
  };

  console.log(`MCP Server configured with: ${tools.length} tools, ${prompts.length} prompts, ${resources.length} resources, ${resourceTemplates.length} resource templates`);

  // Helper functions for JSON-RPC message handling
  const isRequest = (msg: any): msg is JSONRPCRequest => {
    return typeof msg === 'object' && msg !== null && 
           msg.jsonrpc === '2.0' && 
           'method' in msg && 
           'id' in msg && 
           msg.id !== null;
  };

  const isNotification = (msg: any): msg is JSONRPCNotification => {
    return typeof msg === 'object' && msg !== null && 
           msg.jsonrpc === '2.0' && 
           'method' in msg && 
           !('id' in msg);
  };

  // Process a single MCP request or notification
  const processMessage = async (
    message: JSONRPCRequest | JSONRPCNotification
  ): Promise<JSONRPCResponse | JSONRPCError | null> => {
    const { method, params } = message;
    const id = 'id' in message ? message.id : null;

    try {
      let result: any;

      if (method === 'initialize') {
        result = {
          protocolVersion: "2024-11-05",
          capabilities,
          serverInfo: {
            name: 'MCP Server',
            version: '1.0.0',
          }
        };
      } else if (method === 'tools/list') {
        result = {
          tools: Array.from(toolMap.values())
            .filter(t => t.enabled)
            .map(t => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema ? zodToJsonSchema(t.inputSchema) : { type: 'object' },
              ...(t.outputSchema ? { outputSchema: t.outputSchema } : {}),
              ...(t.annotations ? { annotations: t.annotations } : {})
            })),
          nextCursor: undefined
        };
      } else if (method === 'tools/call') {
        if (!params || !params.name || !('arguments' in params)) {
          throw { code: -32602, message: 'Invalid parameters for tools/call' };
        }

        const tool = toolMap.get(params.name);
        if (!tool) {
          throw { code: -32602, message: `Tool "${params.name}" not found` };
        }
        if (!tool.enabled) {
          throw { code: -32602, message: `Tool "${params.name}" disabled` };
        }

        result = await tool.callback(params.arguments);
      } else if (method === 'prompts/list') {
        result = {
          prompts: Array.from(promptMap.values())
            .filter(p => p.enabled)
            .map(p => {
              let args;
              if (p.arguments) {
                args = p.arguments;
              } else if (p.argsSchema) {
                args = Object.entries(p.argsSchema.shape || {}).map(([name, field]) => ({
                  name,
                  description: (field as any)?.description,
                  required: !(field as any)?.isOptional?.(),
                }));
              }

              return {
                name: p.name,
                description: p.description,
                arguments: args
              };
            }),
          nextCursor: undefined
        };
      } else if (method === 'prompts/get') {
        if (!params || !params.name || !('arguments' in params)) {
          throw { code: -32602, message: 'Invalid parameters for prompts/get' };
        }

        const prompt = promptMap.get(params.name);
        if (!prompt) {
          throw { code: -32602, message: `Prompt "${params.name}" not found` };
        }
        if (!prompt.enabled) {
          throw { code: -32602, message: `Prompt "${params.name}" disabled` };
        }

        result = await prompt.callback(params.arguments);
      } else if (method === 'resources/list') {
        const fixedResources = Array.from(resourceMap.values())
          .filter(r => r.enabled)
          .map(r => ({
            uri: r.uri,
            name: r.name,
            mimeType: r.mimeType,
            description: r.description,
            size: r.size
          }));

        const templateResources: any[] = [];
        for (const template of resourceTemplateMap.values()) {
          if (template.enabled && template.listCallback) {
            const listResult = await template.listCallback();
            templateResources.push(...listResult.resources.map(r => ({
              ...r,
              mimeType: r.mimeType || template.mimeType,
              description: r.description || template.description
            })));
          }
        }

        result = { 
          resources: [...fixedResources, ...templateResources],
          nextCursor: params?.cursor ? undefined : undefined
        };
      } else if (method === 'resources/templates/list') {
        result = {
          resourceTemplates: Array.from(resourceTemplateMap.values())
            .filter(t => t.enabled)
            .map(t => ({
              name: t.name,
              uriTemplate: t.uriTemplate.toString(),
              mimeType: t.mimeType,
              description: t.description
            }))
        };
      } else if (method === 'resources/read') {
        if (!params || !params.uri) {
          throw { code: -32602, message: 'Invalid parameters for resources/read' };
        }

        const uri = new URL(params.uri);
        const resource = resourceMap.get(params.uri);

        if (resource && resource.enabled) {
          result = await resource.readCallback(uri);
        } else {
          let found = false;

          for (const template of resourceTemplateMap.values()) {
            if (!template.enabled) continue;

            const variables = template.uriTemplate.match(params.uri);
            if (variables) {
              result = await template.readCallback(uri, variables);
              found = true;
              break;
            }
          }

          if (!found) {
            throw { code: -32002, message: `Resource "${params.uri}" not found` };
          }
        }
      } else if (method === 'resources/subscribe') {
        if (!params || !params.uri) {
          throw { code: -32602, message: 'Invalid parameters for resources/subscribe' };
        }

        result = {};
      } else if (method === 'notifications/initialized') {
        if (isNotification(message)) {
          return null;
        }
        result = {};
      } else {
        throw { code: -32601, message: `Method "${method}" not found` };
      }

      if (id !== null) {
        return {
          jsonrpc: "2.0",
          id,
          result
        };
      }

      return null;
    } catch (error) {
      if (id === null) {
        return null;
      }

      let errorMessage = 'Internal Server Error';
      let errorCode = -32603;
      let errorData: any = undefined;

      if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
        errorCode = error.code;
        errorMessage = error.message;
        errorData = error.data;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      return {
        jsonrpc: "2.0",
        id,
        error: { 
          code: errorCode, 
          message: errorMessage,
          ...(errorData ? { data: errorData } : {})
        }
      };
    }
  };

  // Request handler
  const handleRequest = async (req: Request): Promise<Response> => {
    return await measure(async () => {
      const url = new URL(req.url);
      const origin = req.headers.get('Origin') || '*';

      if (req.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Accept',
            'Access-Control-Max-Age': '86400',
          }
        });
      }

      if (url.pathname !== '/mcp') {
        return new Response('Not Found', { 
          status: 404,
          headers: {
            'Access-Control-Allow-Origin': origin,
          }
        });
      }

      if (req.method !== 'POST') {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Method not allowed. Only POST is supported.' },
          id: null,
        }), {
          status: 405,
          headers: { 
            'Allow': 'POST, OPTIONS',
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': origin,
          }
        });
      }

      const contentType = req.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          error: { 
            code: -32000, 
            message: 'Unsupported Media Type: Content-Type must be application/json' 
          },
          id: null,
        }), { 
          status: 415,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': origin
          }
        });
      }

      try {
        const body = await req.json();
        const messages = Array.isArray(body) ? body : [body];
        const validMessages = messages.filter(msg => 
          typeof msg === 'object' && 
          msg !== null && 
          msg.jsonrpc === '2.0' && 
          'method' in msg
        );

        if (validMessages.length === 0) {
          return new Response(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32600, message: 'Invalid Request: No valid JSON-RPC messages' },
            id: null,
          }), { 
            status: 400,
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': origin
            }
          });
        }

        const hasRequests = validMessages.some(isRequest);
        if (!hasRequests) {
          validMessages.forEach(message => {
            if (isNotification(message)) {
              processMessage(message).catch(console.error);
            }
          });

          return new Response(null, { 
            status: 202,
            headers: {
              'Access-Control-Allow-Origin': origin
            }
          });
        }

        const responses: any[] = [];

        for (const message of validMessages) {
          if (isRequest(message)) {
            const response = await processMessage(message);
            if (response) {
              responses.push(response);
            }
          } else if (isNotification(message)) {
            processMessage(message).catch(console.error);
          }
        }

        if (Array.isArray(body) && responses.length > 1) {
          return new Response(JSON.stringify(responses), {
            status: 200,
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': origin
            }
          });
        } else if (responses.length > 0) {
          return new Response(JSON.stringify(responses[0]), {
            status: 200,
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': origin
            }
          });
        } else {
          return new Response(null, { 
            status: 202,
            headers: {
              'Access-Control-Allow-Origin': origin
            }
          });
        }
      } catch (error) {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          error: { 
            code: -32603, 
            message: 'Internal error', 
            data: error instanceof Error ? error.message : String(error)
          },
          id: null,
        }), {
          status: 500,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': origin
          }
        });
      }
    }, `${req.method} ${req.url}`, { requestId: randomUUID().slice(0, 8) });
  };

  // Create and start the HTTP server
  const server = Bun.serve({
    port: process.env.PORT ? parseInt(process.env.PORT) : port,
    fetch: fetch || handleRequest,
  });

  console.log(`MCP Server running at http://localhost:${server.port}/mcp`);

  return server;
}