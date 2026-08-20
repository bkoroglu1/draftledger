-- Self-referencing foreign keys and integrity constraints that are declared in
-- application code but not expressible in the base table definitions, plus the
-- full-text search index used by /search.

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_current_revision_fk"
  FOREIGN KEY ("current_revision_id") REFERENCES "revisions"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_published_revision_fk"
  FOREIGN KEY ("published_revision_id") REFERENCES "revisions"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_derived_from_fk"
  FOREIGN KEY ("derived_from_document_id") REFERENCES "documents"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "sections"
  ADD CONSTRAINT "sections_parent_fk"
  FOREIGN KEY ("parent_id") REFERENCES "sections"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "review_threads"
  ADD CONSTRAINT "review_threads_carried_from_fk"
  FOREIGN KEY ("carried_from_thread_id") REFERENCES "review_threads"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "namespaces"
  ADD CONSTRAINT "namespaces_workflow_fk"
  FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "notification_policies"
  ADD CONSTRAINT "notification_policies_superseded_fk"
  FOREIGN KEY ("superseded_by_id") REFERENCES "notification_policies"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "publications"
  ADD CONSTRAINT "publications_job_fk"
  FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL;
--> statement-breakpoint

-- A revision snapshot is immutable: block UPDATE/DELETE on immutable rows.
CREATE OR REPLACE FUNCTION draftledger_guard_immutable_revision() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    IF OLD.is_immutable AND OLD.is_publication THEN
      RAISE EXCEPTION 'immutable_revision: published revision % cannot be deleted', OLD.slug;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.is_immutable AND (
       NEW.source IS DISTINCT FROM OLD.source
    OR NEW.source_sha256 IS DISTINCT FROM OLD.source_sha256
    OR NEW.canonical_format IS DISTINCT FROM OLD.canonical_format
    OR NEW.sequence IS DISTINCT FROM OLD.sequence
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'immutable_revision: revision % is immutable', OLD.slug;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER revisions_immutability
  BEFORE UPDATE OR DELETE ON "revisions"
  FOR EACH ROW EXECUTE FUNCTION draftledger_guard_immutable_revision();
--> statement-breakpoint

-- Audit events are append-only for normal application flows.
CREATE OR REPLACE FUNCTION draftledger_guard_audit_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit events are append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION draftledger_guard_audit_append_only();
--> statement-breakpoint

-- Search index over local document identity + abstract.
CREATE INDEX "documents_search_idx" ON "documents"
  USING GIN (to_tsvector('simple',
    coalesce("slug",'') || ' ' ||
    coalesce("document_number",'') || ' ' ||
    coalesce("display_name",'') || ' ' ||
    coalesce("title",'') || ' ' ||
    coalesce("abstract",'')));
--> statement-breakpoint
CREATE INDEX "documents_slug_trgm_idx" ON "documents" (lower("slug") text_pattern_ops);
--> statement-breakpoint
CREATE INDEX "revisions_created_idx" ON "revisions" ("document_id", "created_at");
--> statement-breakpoint
CREATE INDEX "errata_status_idx" ON "errata" ("document_id", "status");
