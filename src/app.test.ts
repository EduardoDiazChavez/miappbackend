import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";

Reflect.set(process.env, "NODE_ENV", "test");
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/miapp-test";
process.env.JWT_SECRET ??= "unit-test-secret-with-at-least-thirty-two-characters";
process.env.GOOGLE_CLIENT_ID ??= "";
process.env.FRONTEND_ORIGIN = "http://localhost:3000/";
process.env.COOKIE_SECURE ??= "false";

const { app } = await import("./app.js");

test("API exposes health and rejects requests to missing routes", async (context) => {
  const server = app.listen(0);
  await once(server, "listening");
  context.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });

  const missing = await fetch(`${baseUrl}/not-a-route`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "Ruta no encontrada." });
});

test("CORS accepts the frontend origin when its configured URL ends with a slash", async (context) => {
  const server = app.listen(0);
  await once(server, "listening");
  context.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const response = await fetch(`${baseUrl}/not-a-route`, {
    method: "POST",
    headers: { Origin: "http://localhost:3000" },
  });

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:3000");
});

test("ticket APIs require a session before reading or writing", async (context) => {
  const server = app.listen(0);
  await once(server, "listening");
  context.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const response = await fetch(`${baseUrl}/tickets`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Debes iniciar sesión." });
});
