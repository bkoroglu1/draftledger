-- Required sections are a workflow gate, not a template property: validation
-- reads them from `workflows.gates` (kind = 'required-sections'). The column
-- here was never read, so it could only disagree with the gate that is enforced.
ALTER TABLE "templates" DROP COLUMN IF EXISTS "required_sections";
