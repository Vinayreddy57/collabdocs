
import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../server.js";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

describe("CollabDocs document permissions", () => {
  it("prevents Bob from editing Alice's private document", async () => {
    const created = await request(app)
      .post("/api/documents")
      .set("x-demo-user", ALICE)
      .send({
        title: "Automated Permission Test",
        content: {
          type: "doc",
          content: [{ type: "paragraph" }]
        }
      });

    expect(created.status).toBe(201);

    const documentId = created.body.id;

    try {
      const response = await request(app)
        .patch(`/api/documents/${documentId}`)
        .set("x-demo-user", BOB)
        .send({
          title: "Unauthorized Change"
        });

      expect(response.status).toBe(403);
    } finally {
      await request(app)
        .delete(`/api/documents/${documentId}`)
        .set("x-demo-user", ALICE);
    }
  });
});
