CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"gate_key" text NOT NULL,
	"decision" text NOT NULL,
	"note" text,
	"revision_sha256" text NOT NULL,
	"is_stale" boolean DEFAULT false NOT NULL,
	"approver_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"format" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"sha256" text NOT NULL,
	"byte_length" integer NOT NULL,
	"source_url" text,
	"etag" text,
	"last_modified" text,
	"fetched_at" timestamp with time zone,
	"parser_version" text,
	"sync_status" text DEFAULT 'generated' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_key" text NOT NULL,
	"document_id" uuid,
	"revision_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actor_id" uuid,
	"actor_kind" text DEFAULT 'user' NOT NULL,
	"origin" text DEFAULT 'local' NOT NULL,
	"correlation_id" text,
	"visibility" text DEFAULT 'group' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_authors" (
	"document_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" text DEFAULT 'author' NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "document_authors_document_id_person_id_role_pk" PRIMARY KEY("document_id","person_id","role")
);
--> statement-breakpoint
CREATE TABLE "document_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_document_id" uuid NOT NULL,
	"target_document_id" uuid,
	"target_ref" text,
	"target_title" text,
	"type" text NOT NULL,
	"source_system" text DEFAULT 'local' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_watchers" (
	"document_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_watchers_document_id_person_id_pk" PRIMARY KEY("document_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origin" text DEFAULT 'local' NOT NULL,
	"namespace_id" uuid,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"family_key" text NOT NULL,
	"document_number" text,
	"type" text DEFAULT 'standard' NOT NULL,
	"title" text NOT NULL,
	"abstract" text,
	"standard_level" text DEFAULT 'proposed' NOT NULL,
	"intended_status" text,
	"status" text DEFAULT 'drafting' NOT NULL,
	"visibility" text DEFAULT 'group' NOT NULL,
	"canonical_format" text DEFAULT 'markdown' NOT NULL,
	"group_id" uuid,
	"owner_id" uuid,
	"license_profile_id" uuid,
	"workflow_id" uuid,
	"working_source" text DEFAULT '' NOT NULL,
	"working_source_updated_at" timestamp with time zone,
	"working_source_version" integer DEFAULT 0 NOT NULL,
	"current_revision_id" uuid,
	"published_revision_id" uuid,
	"published_at" timestamp with time zone,
	"pages" integer,
	"word_count" integer,
	"source_system" text,
	"source_ref" text,
	"source_url" text,
	"last_synced_at" timestamp with time zone,
	"sync_state" text DEFAULT 'local' NOT NULL,
	"derived_from_document_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "errata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"revision_id" uuid,
	"number" integer NOT NULL,
	"type" text DEFAULT 'editorial' NOT NULL,
	"status" text DEFAULT 'reported' NOT NULL,
	"section_anchor" text,
	"section_number" text,
	"original_text" text,
	"corrected_text" text,
	"notes" text,
	"reporter_id" uuid,
	"reporter_name" text,
	"verifier_id" uuid,
	"verified_at" timestamp with time zone,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"group_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_members_group_id_person_id_role_pk" PRIMARY KEY("group_id","person_id","role")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'working-group' NOT NULL,
	"description" text,
	"charter" text,
	"contact_policy" text DEFAULT 'owners-only' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ipr_disclosures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"title" text NOT NULL,
	"holder" text NOT NULL,
	"statement" text,
	"origin" text DEFAULT 'local' NOT NULL,
	"external_url" text,
	"disclosed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"dedupe_key" text,
	"state" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"locked_by" text,
	"result" jsonb,
	"error" text,
	"correlation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "license_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"copyright_holder" text NOT NULL,
	"notice_text" text NOT NULL,
	"reuse_policy" text DEFAULT 'internal-only' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "namespaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"number_pattern" text DEFAULT '{prefix}-{seq:4}' NOT NULL,
	"prefix" text NOT NULL,
	"next_sequence" integer DEFAULT 1 NOT NULL,
	"draft_prefix" text DEFAULT 'DRAFT' NOT NULL,
	"workflow_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid,
	"event_key" text NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"policy_version" integer DEFAULT 1 NOT NULL,
	"recipients" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"error_class" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"catalog_version" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_expansions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"revision_id" uuid,
	"event_key" text NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"policy_versions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"scope_ref" text,
	"event_key" text NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"precedence" integer DEFAULT 0 NOT NULL,
	"to_selectors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cc_selectors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suppress_selectors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"template" text,
	"version" integer DEFAULT 1 NOT NULL,
	"superseded_by_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handle" text NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"email_visibility" text DEFAULT 'organization' NOT NULL,
	"affiliation" text,
	"bio" text,
	"org_role" text DEFAULT 'reader' NOT NULL,
	"password_hash" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_external" boolean DEFAULT false NOT NULL,
	"external_source" text,
	"external_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"document_number" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"state" text DEFAULT 'running' NOT NULL,
	"error" text,
	"job_id" uuid,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"body" text NOT NULL,
	"suggestion" text,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"requested_by" uuid,
	"note" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"anchor" text,
	"section_number" text,
	"source_start_line" integer,
	"source_end_line" integer,
	"quoted_text" text,
	"type" text DEFAULT 'comment' NOT NULL,
	"severity" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assignee_id" uuid,
	"carried_from_thread_id" uuid,
	"is_orphaned" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"sequence" integer NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"is_immutable" boolean DEFAULT true NOT NULL,
	"is_publication" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"change_summary" text,
	"source" text NOT NULL,
	"source_kind" text DEFAULT 'authored' NOT NULL,
	"source_storage_key" text,
	"source_sha256" text NOT NULL,
	"canonical_format" text NOT NULL,
	"parser_version" text NOT NULL,
	"renderer_version" text NOT NULL,
	"render_state" text DEFAULT 'pending' NOT NULL,
	"render_error" text,
	"pages" integer,
	"word_count" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"parent_id" uuid,
	"number" text,
	"title" text NOT NULL,
	"depth" integer NOT NULL,
	"anchor" text NOT NULL,
	"page_number" integer,
	"source_start" integer,
	"source_end" integer,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"adapter" text NOT NULL,
	"mode" text NOT NULL,
	"document_ref" text,
	"document_id" uuid,
	"state" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text,
	"log" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"canonical_format" text DEFAULT 'markdown' NOT NULL,
	"body" text NOT NULL,
	"required_sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"states" jsonb NOT NULL,
	"gates" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_approver_id_people_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_people_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_authors" ADD CONSTRAINT "document_authors_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_authors" ADD CONSTRAINT "document_authors_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_relations" ADD CONSTRAINT "document_relations_source_document_id_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_relations" ADD CONSTRAINT "document_relations_target_document_id_documents_id_fk" FOREIGN KEY ("target_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_watchers" ADD CONSTRAINT "document_watchers_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_watchers" ADD CONSTRAINT "document_watchers_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_id_people_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_license_profile_id_license_profiles_id_fk" FOREIGN KEY ("license_profile_id") REFERENCES "public"."license_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_people_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "errata" ADD CONSTRAINT "errata_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "errata" ADD CONSTRAINT "errata_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "errata" ADD CONSTRAINT "errata_reporter_id_people_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "errata" ADD CONSTRAINT "errata_verifier_id_people_id_fk" FOREIGN KEY ("verifier_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ipr_disclosures" ADD CONSTRAINT "ipr_disclosures_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_expansions" ADD CONSTRAINT "notification_expansions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_expansions" ADD CONSTRAINT "notification_expansions_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_policies" ADD CONSTRAINT "notification_policies_created_by_people_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_published_by_people_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_thread_id_review_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."review_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_author_id_people_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_rounds" ADD CONSTRAINT "review_rounds_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_rounds" ADD CONSTRAINT "review_rounds_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_rounds" ADD CONSTRAINT "review_rounds_requested_by_people_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_threads" ADD CONSTRAINT "review_threads_round_id_review_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."review_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_threads" ADD CONSTRAINT "review_threads_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_threads" ADD CONSTRAINT "review_threads_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_threads" ADD CONSTRAINT "review_threads_assignee_id_people_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_threads" ADD CONSTRAINT "review_threads_created_by_people_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_threads" ADD CONSTRAINT "review_threads_resolved_by_people_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_created_by_people_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_doc_idx" ON "approvals" USING btree ("document_id","revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_rev_format_uq" ON "artifacts" USING btree ("revision_id","format");--> statement-breakpoint
CREATE INDEX "audit_family_idx" ON "audit_events" USING btree ("family_key","created_at");--> statement-breakpoint
CREATE INDEX "audit_doc_idx" ON "audit_events" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_action_idx" ON "audit_events" USING btree ("action");--> statement-breakpoint
CREATE INDEX "relations_source_idx" ON "document_relations" USING btree ("source_document_id","type");--> statement-breakpoint
CREATE INDEX "relations_target_idx" ON "document_relations" USING btree ("target_document_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_slug_uq" ON "documents" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "documents_family_idx" ON "documents" USING btree ("family_key");--> statement-breakpoint
CREATE INDEX "documents_status_idx" ON "documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "documents_group_idx" ON "documents" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "errata_doc_number_uq" ON "errata" USING btree ("document_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_slug_uq" ON "groups" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "ipr_doc_idx" ON "ipr_disclosures" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "jobs_state_runat_idx" ON "jobs" USING btree ("state","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_uq" ON "jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "license_profiles_key_uq" ON "license_profiles" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "namespaces_key_uq" ON "namespaces" USING btree ("key");--> statement-breakpoint
CREATE INDEX "notif_delivery_doc_idx" ON "notification_deliveries" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_events_key_uq" ON "notification_events" USING btree ("key");--> statement-breakpoint
CREATE INDEX "notif_expansion_doc_idx" ON "notification_expansions" USING btree ("document_id","event_key");--> statement-breakpoint
CREATE INDEX "notif_policy_lookup_idx" ON "notification_policies" USING btree ("event_key","scope","scope_ref","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "people_handle_uq" ON "people" USING btree ("handle");--> statement-breakpoint
CREATE UNIQUE INDEX "publications_number_uq" ON "publications" USING btree ("document_number");--> statement-breakpoint
CREATE INDEX "review_comments_thread_idx" ON "review_comments" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "review_rounds_doc_seq_uq" ON "review_rounds" USING btree ("document_id","sequence");--> statement-breakpoint
CREATE INDEX "review_threads_round_idx" ON "review_threads" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "review_threads_doc_idx" ON "review_threads" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "revisions_slug_uq" ON "revisions" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "revisions_doc_seq_uq" ON "revisions" USING btree ("document_id","sequence");--> statement-breakpoint
CREATE INDEX "revisions_doc_idx" ON "revisions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "sections_rev_idx" ON "sections" USING btree ("revision_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "sections_rev_anchor_uq" ON "sections" USING btree ("revision_id","anchor");--> statement-breakpoint
CREATE INDEX "sessions_person_idx" ON "sessions" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "sync_runs_doc_idx" ON "sync_runs" USING btree ("document_ref","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "templates_key_uq" ON "templates" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_key_uq" ON "workflows" USING btree ("key");