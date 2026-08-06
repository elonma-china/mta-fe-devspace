// ===========================================
// MongoDB init script for IntraMind
// Runs inside /docker-entrypoint-initdb.d/
// ===========================================

// Switch to the application database
db = db.getSiblingDB("intramind");

// --- Collection: conversation_data ---
db.createCollection("conversation_data", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["conversation_id", "user_id", "messages"],
      properties: {
        conversation_id: {
          bsonType: "int",
          description: "FK to PostgreSQL conversation.id",
        },
        user_id: {
          bsonType: "int",
          description: "FK to PostgreSQL user.id",
        },
        messages: {
          bsonType: "array",
          description: "Chat message history",
          items: {
            bsonType: "object",
            properties: {
              q: { bsonType: "string", description: "User question" },
              a: { bsonType: "string", description: "AI answer" },
              sources: {
                bsonType: "array",
                description: "Source references",
                items: {
                  bsonType: "object",
                  properties: {
                    enriched_content: { bsonType: "string" },
                    document_id: {
                      bsonType: "string",
                      description: "UUID referencing document table",
                    },
                    metadata: { bsonType: "object" },
                  },
                },
              },
            },
          },
        },
        created_at: { bsonType: "date" },
        updated_at: { bsonType: "date" },
      },
    },
  },
  validationLevel: "moderate",
  validationAction: "warn",
});

// Unique index: one mongo doc per conversation
db.conversation_data.createIndex(
  { conversation_id: 1 },
  { unique: true, name: "idx_conversation_id_unique" }
);

// Index for user-scoped queries
db.conversation_data.createIndex(
  { user_id: 1 },
  { name: "idx_user_id" }
);

print("✓ MongoDB initialized: collection 'conversation_data' with indexes");
