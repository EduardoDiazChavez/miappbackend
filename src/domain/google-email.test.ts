import assert from "node:assert/strict";
import { test } from "node:test";
import { isAllowedGoogleEmail } from "./google-email.js";

test("Google login accepts only exact mrm.com.ve email domains", () => {
  assert.equal(isAllowedGoogleEmail("employee@mrm.com.ve"), true);
  assert.equal(isAllowedGoogleEmail("EMPLOYEE@MRM.COM.VE"), true);
  assert.equal(isAllowedGoogleEmail(" employee@mrm.com.ve "), true);
  assert.equal(isAllowedGoogleEmail("employee@sub.mrm.com.ve"), false);
  assert.equal(isAllowedGoogleEmail("employee@mrm.com.ve.example"), false);
  assert.equal(isAllowedGoogleEmail("employee@other.com"), false);
  assert.equal(isAllowedGoogleEmail("@mrm.com.ve"), false);
});
