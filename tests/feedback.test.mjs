// Run: node --test local/tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { screenOf, iosVersion, feedbackText, NOT_A_SCREEN } from "../js/feedback.js";

test("screenOf keeps the page and the month, drops record ids", () => {
  assert.deepEqual(screenOf("#/ops/2026-11"), { key: "ops", detail: "2026-11" });
  assert.deepEqual(screenOf("#/ops/all"), { key: "ops", detail: "tout" });
  assert.deepEqual(screenOf("#/project/abc-123"), { key: "project", detail: "" });
  assert.deepEqual(screenOf(""), { key: "home", detail: "" });
  assert.deepEqual(screenOf("#/unknown"), { key: "other", detail: "" });
  assert.ok(NOT_A_SCREEN.has("more") && NOT_A_SCREEN.has("feedback"));
});

test("iosVersion reads iPhone user agents only", () => {
  const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15";
  assert.equal(iosVersion(ua), "iOS 18.1");
  assert.equal(iosVersion("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"), "");
});

test("feedbackText holds the screen, the message and the context only", () => {
  const text = feedbackText({
    key: "ops", detail: "2026-11", message: "  Le filtre ne marche pas \n",
    version: "v5", userAgent: "iPhone; CPU iPhone OS 18_1 like", standalone: true,
  });
  assert.equal(text, "Retour Open Budget\nÉcran : Opérations (2026-11)\n\nLe filtre ne marche pas\n\n— version v5, iOS 18.1, écran d'accueil");
});
