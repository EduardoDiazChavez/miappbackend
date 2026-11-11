import assert from "node:assert/strict";
import { test } from "node:test";

process.env.NODE_ENV ??= "test";
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/miapp-test";
process.env.JWT_SECRET ??= "unit-test-secret-with-at-least-thirty-two-characters";
process.env.FRONTEND_ORIGIN ??= "http://localhost:3000";
process.env.COOKIE_SECURE ??= "false";

const { createMongoConnectOptions } = await import("./database.js");

test("remote MongoDB connections require TLS and certificate validation", () => {
  const options = createMongoConnectOptions(
    "mongodb+srv://user:password@cluster.example/miapp",
    "development",
  );

  assert.equal(options.tls, true);
  assert.equal(options.appName, "miapp-api");
  assert.equal(options.serverSelectionTimeoutMS, 10_000);
  assert.equal(options.maxPoolSize, 10);
});

test("remote standard connections also require TLS", () => {
  const options = createMongoConnectOptions(
    "mongodb://db.example:27017/miapp",
    "development",
  );

  assert.equal(options.tls, true);
});

test("standard connection strings with multiple hosts require TLS", () => {
  const options = createMongoConnectOptions(
    "mongodb://db-0.example:27017,db-1.example:27017/miapp",
    "development",
  );

  assert.equal(options.tls, true);
});

test("local development MongoDB can run without TLS", () => {
  const options = createMongoConnectOptions(
    "mongodb://127.0.0.1:27017/miapp",
    "development",
  );

  assert.equal(options.tls, false);
});

test("production MongoDB connections require TLS, including loopback hosts", () => {
  const options = createMongoConnectOptions(
    "mongodb://127.0.0.1:27017/miapp",
    "production",
  );

  assert.equal(options.tls, true);
  assert.equal(options.autoIndex, false);
});

test("remote MongoDB connections reject TLS downgrade and invalid-certificate options", () => {
  assert.throws(
    () => createMongoConnectOptions(
      "mongodb+srv://user:password@cluster.example/miapp?tls=false",
      "development",
    ),
    /TLS cannot be disabled/,
  );
  assert.throws(
    () => createMongoConnectOptions(
      "mongodb+srv://user:password@cluster.example/miapp?tlsInsecure=true",
      "development",
    ),
    /certificate and hostname validation cannot be disabled/,
  );
  assert.throws(
    () => createMongoConnectOptions(
      "mongodb://db.example/miapp?tlsAllowInvalidHostnames=true",
      "development",
    ),
    /certificate and hostname validation cannot be disabled/,
  );
});
