import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNewGoogleUser } from "./google-user.js";

test("new Google users receive an active ADVISOR account", () => {
  assert.deepEqual(
    buildNewGoogleUser({
      email: "employee@mrm.com.ve",
      name: "  Employee Name  ",
      subject: "google-subject",
    }),
    {
      email: "employee@mrm.com.ve",
      name: "Employee Name",
      role: "ADVISOR",
      active: true,
      googleSubject: "google-subject",
    },
  );
});

test("new Google users fall back to their email local part when no name is provided", () => {
  assert.equal(
    buildNewGoogleUser({
      email: "employee@mrm.com.ve",
      subject: "google-subject",
    }).name,
    "employee",
  );
});
