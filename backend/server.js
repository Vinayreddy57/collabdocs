
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { z } = require("zod");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 5000;

// ========================================
// Configuration
// ========================================

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: allowedOrigins
}));

app.use(express.json({
  limit: "1mb"
}));

// ========================================
// Demo Users
// ========================================

const ALICE_ID =
  "11111111-1111-4111-8111-111111111111";

const BOB_ID =
  "22222222-2222-4222-8222-222222222222";

const DEMO_USERS = [ALICE_ID, BOB_ID];

// Demo-only authentication.
// Never use a client-supplied user ID as
// authentication for real user accounts.
app.use("/api", (req, res, next) => {
  const userId =
    req.header("x-demo-user") || ALICE_ID;

  if (!DEMO_USERS.includes(userId)) {
    return res.status(401).json({
      error: "Invalid demo user"
    });
  }

  req.userId = userId;
  next();
});

// ========================================
// Validation
// ========================================

const UUID_SCHEMA = z.string().uuid();

const contentSchema = z.object({
  type: z.literal("doc"),
  content: z.array(z.unknown()).optional()
});

const documentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: contentSchema
});

const updateSchema = documentSchema
  .partial()
  .refine(
    data => Object.keys(data).length > 0,
    "Provide at least one field"
  );

function validateDocumentId(req, res, next) {
  if (!UUID_SCHEMA.safeParse(req.params.id).success) {
    return res.status(400).json({
      error: "Invalid document ID"
    });
  }

  next();
}

// ========================================
// File Upload Configuration
// ========================================

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 1024 * 1024
  },

  fileFilter: (req, file, cb) => {
    if (!/\.(txt|md)$/i.test(file.originalname)) {
      return cb(
        new Error(
          "Only .txt and .md files are supported"
        )
      );
    }

    cb(null, true);
  }
});

// ========================================
// Health Endpoint
// ========================================

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    application: "CollabDocs"
  });
});

// ========================================
// GET - List Accessible Documents
// ========================================

app.get("/api/documents", async (req, res, next) => {
  try {
    const result = await pool.query(
      `
      SELECT
        d.id,
        d.title,
        d.content,
        d.owner_id,
        d.created_at,
        d.updated_at,
        u.name AS owner_name,
        CASE
          WHEN d.owner_id = $1
          THEN 'owned'
          ELSE 'shared'
        END AS access_type,
        CASE
          WHEN d.owner_id = $1
          THEN 'edit'
          ELSE s.permission
        END AS permission
      FROM documents d
      JOIN users u
        ON u.id = d.owner_id
      LEFT JOIN document_shares s
        ON s.document_id = d.id
        AND s.user_id = $1
      WHERE d.owner_id = $1
         OR s.user_id = $1
      ORDER BY d.updated_at DESC
      `,
      [req.userId]
    );

    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// ========================================
// POST - Create Document
// ========================================

app.post("/api/documents", async (req, res, next) => {
  try {
    const parsed = documentSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid document data"
      });
    }

    const { title, content } = parsed.data;

    const result = await pool.query(
      `
      INSERT INTO documents
        (title, content, owner_id)
      VALUES ($1, $2::jsonb, $3)
      RETURNING *
      `,
      [
        title,
        JSON.stringify(content),
        req.userId
      ]
    );

    res.status(201).json({
      ...result.rows[0],
      access_type: "owned",
      permission: "edit"
    });
  } catch (error) {
    next(error);
  }
});

// ========================================
// GET - Open Document
// ========================================

app.get(
  "/api/documents/:id",
  validateDocumentId,
  async (req, res, next) => {
    try {
      const result = await pool.query(
        `
        SELECT
          d.*,
          CASE
            WHEN d.owner_id = $2
            THEN 'owned'
            ELSE 'shared'
          END AS access_type,
          CASE
            WHEN d.owner_id = $2
            THEN 'edit'
            ELSE s.permission
          END AS permission
        FROM documents d
        LEFT JOIN document_shares s
          ON s.document_id = d.id
          AND s.user_id = $2
        WHERE d.id = $1
          AND (
            d.owner_id = $2
            OR s.user_id = $2
          )
        `,
        [req.params.id, req.userId]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          error: "Document not found or access denied"
        });
      }

      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

// ========================================
// PATCH - Save or Rename Document
// ========================================

app.patch(
  "/api/documents/:id",
  validateDocumentId,
  async (req, res, next) => {
    try {
      const parsed = updateSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid document update"
        });
      }

      const { title, content } = parsed.data;

      const result = await pool.query(
        `
        UPDATE documents d
        SET
          title = COALESCE($1, d.title),
          content = COALESCE(
            $2::jsonb,
            d.content
          ),
          updated_at = NOW()
        WHERE d.id = $3
          AND (
            d.owner_id = $4
            OR EXISTS (
              SELECT 1
              FROM document_shares s
              WHERE s.document_id = d.id
                AND s.user_id = $4
                AND s.permission = 'edit'
            )
          )
        RETURNING *
        `,
        [
          title ?? null,
          content
            ? JSON.stringify(content)
            : null,
          req.params.id,
          req.userId
        ]
      );

      if (!result.rows.length) {
        return res.status(403).json({
          error: "Edit permission required"
        });
      }

      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

// ========================================
// DELETE - Delete Owned Document
// ========================================

app.delete(
  "/api/documents/:id",
  validateDocumentId,
  async (req, res, next) => {
    try {
      const result = await pool.query(
        `
        DELETE FROM documents
        WHERE id = $1
          AND owner_id = $2
        RETURNING id
        `,
        [req.params.id, req.userId]
      );

      if (!result.rows.length) {
        return res.status(403).json({
          error: "Only the owner can delete a document"
        });
      }

      res.json({
        deleted: true,
        id: result.rows[0].id
      });
    } catch (error) {
      next(error);
    }
  }
);

// ========================================
// POST - Share Document
// ========================================

app.post(
  "/api/documents/:id/share",
  validateDocumentId,
  async (req, res, next) => {
    try {
      const shareSchema = z.object({
        userId: z.enum([
          ALICE_ID,
          BOB_ID
        ]),
        permission: z.enum([
          "view",
          "edit"
        ])
      });

      const parsed = shareSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({
          error: "Invalid sharing request"
        });
      }

      const { userId, permission } = parsed.data;

      if (userId === req.userId) {
        return res.status(400).json({
          error: "Cannot share with yourself"
        });
      }

      const result = await pool.query(
        `
        INSERT INTO document_shares
          (document_id, user_id, permission)
        SELECT id, $3, $4
        FROM documents
        WHERE id = $1
          AND owner_id = $2
        ON CONFLICT (document_id, user_id)
        DO UPDATE SET
          permission = EXCLUDED.permission
        RETURNING document_id
        `,
        [
          req.params.id,
          req.userId,
          userId,
          permission
        ]
      );

      if (!result.rows.length) {
        return res.status(403).json({
          error: "Only the owner can share this document"
        });
      }

      res.json({
        shared: true,
        permission,
        userId
      });
    } catch (error) {
      next(error);
    }
  }
);

// ========================================
// POST - Upload .txt or .md File
// ========================================

app.post(
  "/api/upload",
  upload.single("file"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: "Please select a file"
        });
      }

      const filename = req.file.originalname;
      const text = req.file.buffer.toString("utf8");

      if (!text.trim()) {
        return res.status(400).json({
          error: "The uploaded file is empty"
        });
      }

      const lines = text.split(/\r?\n/);

      const content = {
        type: "doc",
        content: lines.map(line => ({
          type: "paragraph",
          ...(line
            ? {
                content: [
                  {
                    type: "text",
                    text: line
                  }
                ]
              }
            : {})
        }))
      };

      const title =
        filename
          .replace(/\.(txt|md)$/i, "")
          .trim()
          .slice(0, 200) ||
        "Imported Document";

      const result = await pool.query(
        `
        INSERT INTO documents
          (title, content, owner_id)
        VALUES ($1, $2::jsonb, $3)
        RETURNING *
        `,
        [
          title,
          JSON.stringify(content),
          req.userId
        ]
      );

      res.status(201).json({
        ...result.rows[0],
        access_type: "owned",
        permission: "edit"
      });
    } catch (error) {
      next(error);
    }
  }
);

// ========================================
// Error Handling
// ========================================

app.use((error, req, res, next) => {
  console.error(
    "CollabDocs error:",
    error.message
  );

  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      error:
        error.code === "LIMIT_FILE_SIZE"
          ? "Maximum upload size is 1 MB"
          : "Invalid file upload"
    });
  }

  if (
    error.message ===
    "Only .txt and .md files are supported"
  ) {
    return res.status(400).json({
      error: error.message
    });
  }

  if (error.code === "22P02") {
    return res.status(400).json({
      error: "Invalid database identifier"
    });
  }

  res.status(500).json({
    error: "Internal server error"
  });
});

// ========================================
// Start Server
// ========================================


if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`CollabDocs API running on port ${PORT}`);
  });
}

module.exports = app;

