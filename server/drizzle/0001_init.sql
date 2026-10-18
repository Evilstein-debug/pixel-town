CREATE TYPE "public"."llm_purpose" AS ENUM('importance', 'plan', 'replan', 'talk_decide', 'dialogue', 'reflect');--> statement-breakpoint
CREATE TYPE "public"."memory_type" AS ENUM('observation', 'conversation', 'seeded', 'plan', 'reflection');--> statement-breakpoint
CREATE TYPE "public"."sim_status" AS ENUM('running', 'paused', 'archived');--> statement-breakpoint
CREATE TABLE "agent_state" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"tile_x" smallint NOT NULL,
	"tile_y" smallint NOT NULL,
	"facing" text NOT NULL,
	"current_action" text NOT NULL,
	"status_icon" text NOT NULL,
	"location_id" text,
	"path" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"awake" boolean NOT NULL,
	"runtime" jsonb NOT NULL,
	"updated_at_game" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sim_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"age" smallint NOT NULL,
	"occupation" text NOT NULL,
	"bio" text NOT NULL,
	"relationships" text DEFAULT '' NOT NULL,
	"traits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"home_location_id" text NOT NULL,
	"appearance" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "conversation_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conversation_id" uuid NOT NULL,
	"seq" smallint NOT NULL,
	"speaker_id" uuid NOT NULL,
	"text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sim_id" uuid NOT NULL,
	"location_id" text,
	"started_at_game" integer NOT NULL,
	"participants" uuid[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"sim_id" uuid NOT NULL,
	"at_game" integer NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_calls" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "llm_calls_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"sim_id" uuid NOT NULL,
	"purpose" "llm_purpose" NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"ok" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sim_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"type" "memory_type" NOT NULL,
	"text" text NOT NULL,
	"importance" smallint,
	"created_at_game" integer NOT NULL,
	"last_accessed_game" integer NOT NULL,
	"embedding" vector(384),
	"embedding_model" text,
	"seed_id" uuid,
	"source_ref" jsonb,
	CONSTRAINT "memories_importance_range" CHECK ("memories"."importance" between 1 and 10),
	CONSTRAINT "memories_embedding_model_pair" CHECK (("memories"."embedding" is null) = ("memories"."embedding_model" is null))
);
--> statement-breakpoint
CREATE TABLE "memory_evidence" (
	"reflection_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	CONSTRAINT "memory_evidence_reflection_id_evidence_id_pk" PRIMARY KEY("reflection_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"sim_id" uuid NOT NULL,
	"day" smallint NOT NULL,
	"blocks" jsonb NOT NULL,
	"created_at_game" integer NOT NULL,
	"superseded_at_game" integer
);
--> statement-breakpoint
CREATE TABLE "retrieval_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "retrieval_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"sim_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"at_game" integer NOT NULL,
	"query_text" text NOT NULL,
	"candidate_count" integer NOT NULL,
	"results" jsonb NOT NULL,
	"latency_ms" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"seed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "sim_status" DEFAULT 'running' NOT NULL,
	"game_minutes" integer NOT NULL,
	"config" jsonb NOT NULL,
	"runtime" jsonb NOT NULL,
	"import_hash" text,
	"parent_sim_id" uuid,
	"forked_from_snapshot_id" uuid,
	CONSTRAINT "sims_import_hash_unique" UNIQUE("import_hash")
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sim_id" uuid NOT NULL,
	"name" text NOT NULL,
	"at_game" integer NOT NULL,
	"state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_state" ADD CONSTRAINT "agent_state_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_sim_id_sims_id_fk" FOREIGN KEY ("sim_id") REFERENCES "public"."sims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_lines" ADD CONSTRAINT "conversation_lines_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_lines" ADD CONSTRAINT "conversation_lines_speaker_id_agents_id_fk" FOREIGN KEY ("speaker_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_sim_id_sims_id_fk" FOREIGN KEY ("sim_id") REFERENCES "public"."sims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_sim_id_sims_id_fk" FOREIGN KEY ("sim_id") REFERENCES "public"."sims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_sim_id_sims_id_fk" FOREIGN KEY ("sim_id") REFERENCES "public"."sims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_sim_id_sims_id_fk" FOREIGN KEY ("sim_id") REFERENCES "public"."sims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_seed_id_memories_id_fk" FOREIGN KEY ("seed_id") REFERENCES "public"."memories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_evidence" ADD CONSTRAINT "memory_evidence_reflection_id_memories_id_fk" FOREIGN KEY ("reflection_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_evidence" ADD CONSTRAINT "memory_evidence_evidence_id_memories_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_sim_id_sims_id_fk" FOREIGN KEY ("sim_id") REFERENCES "public"."sims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_logs" ADD CONSTRAINT "retrieval_logs_sim_id_sims_id_fk" FOREIGN KEY ("sim_id") REFERENCES "public"."sims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_logs" ADD CONSTRAINT "retrieval_logs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sims" ADD CONSTRAINT "sims_parent_sim_id_sims_id_fk" FOREIGN KEY ("parent_sim_id") REFERENCES "public"."sims"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sims" ADD CONSTRAINT "sims_forked_from_snapshot_id_snapshots_id_fk" FOREIGN KEY ("forked_from_snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_sim_id_sims_id_fk" FOREIGN KEY ("sim_id") REFERENCES "public"."sims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agents_sim_slug_uq" ON "agents" USING btree ("sim_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_lines_seq_uq" ON "conversation_lines" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE INDEX "conversations_sim_started_idx" ON "conversations" USING btree ("sim_id","started_at_game");--> statement-breakpoint
CREATE INDEX "events_sim_at_idx" ON "events" USING btree ("sim_id","at_game");--> statement-breakpoint
CREATE INDEX "llm_calls_sim_purpose_idx" ON "llm_calls" USING btree ("sim_id","purpose");--> statement-breakpoint
CREATE INDEX "memories_embedding_hnsw_idx" ON "memories" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "memories_agent_recent_idx" ON "memories" USING btree ("sim_id","agent_id","created_at_game" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "memories_agent_importance_idx" ON "memories" USING btree ("sim_id","agent_id","importance" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "memories_agent_seed_idx" ON "memories" USING btree ("sim_id","agent_id") WHERE "memories"."seed_id" is not null;--> statement-breakpoint
CREATE INDEX "memory_evidence_evidence_idx" ON "memory_evidence" USING btree ("evidence_id");--> statement-breakpoint
CREATE INDEX "plans_agent_created_idx" ON "plans" USING btree ("agent_id","created_at_game");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_one_current_uq" ON "plans" USING btree ("agent_id") WHERE "plans"."superseded_at_game" is null;--> statement-breakpoint
CREATE INDEX "retrieval_logs_sim_at_idx" ON "retrieval_logs" USING btree ("sim_id","at_game");--> statement-breakpoint
CREATE INDEX "sims_status_created_idx" ON "sims" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "snapshots_sim_name_uq" ON "snapshots" USING btree ("sim_id","name");