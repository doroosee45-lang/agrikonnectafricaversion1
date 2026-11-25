-- Fondations Academia (V1-F12, CDC V1 §3.11) — migration ADDITIVE.
--
-- Ces objets étaient déclarés dans schema.prisma (depuis e10e28c) sans
-- migration : dérive détectée par `npm run check:migrations` (cause de E8).
-- Le SQL ci-dessous est la sortie EXACTE de
--   prisma migrate diff --from-url <base migrée> --to-schema-datamodel prisma/schema.prisma --script
-- (journal docs/preuves/logs/09-check-migrations.log), complétée du bloc RLS
-- conventionnel du projet pour les 4 nouvelles tables.
--
-- Aucune suppression, aucune modification de donnée existante.
-- NE PAS APPLIQUER sur Supabase sans comparaison préalable de l'état réel
-- (docs/RAPPORT_MIGRATIONS_INTEGRITE_V1.md §4) ni autorisation explicite.

-- CreateEnum
CREATE TYPE "AcademicInstitutionKind" AS ENUM ('UNIVERSITY', 'INSTITUTE', 'SCHOOL', 'RESEARCH_CENTER');

-- CreateEnum
CREATE TYPE "AcademicUnitKind" AS ENUM ('FACULTY', 'DEPARTMENT', 'LABORATORY', 'RESEARCH_CENTER');

-- CreateEnum
CREATE TYPE "AcademicAffiliationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED', 'ENDED');

-- CreateEnum
CREATE TYPE "AcademicProfileVisibility" AS ENUM ('PUBLIC', 'MEMBERS', 'PRIVATE');

-- CreateEnum
CREATE TYPE "AcademicContactPolicy" AS ENUM ('EVERYONE', 'VERIFIED_MEMBERS', 'NOBODY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrgType" ADD VALUE 'UNIVERSITY';
ALTER TYPE "OrgType" ADD VALUE 'RESEARCH_CENTER';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Role" ADD VALUE 'STUDENT';
ALTER TYPE "Role" ADD VALUE 'PROFESSOR';
ALTER TYPE "Role" ADD VALUE 'RESEARCHER';
ALTER TYPE "Role" ADD VALUE 'UNIVERSITY_ADMIN';
ALTER TYPE "Role" ADD VALUE 'LIBRARIAN';
ALTER TYPE "Role" ADD VALUE 'ACADEMIA_ADMIN';

-- CreateTable
CREATE TABLE "academic_institutions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "kind" "AcademicInstitutionKind" NOT NULL DEFAULT 'UNIVERSITY',
    "short_name" TEXT,
    "website" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "logo_url" TEXT,
    "disciplines" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "academic_institutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_units" (
    "id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "kind" "AcademicUnitKind" NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "academic_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_profiles" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "headline" TEXT,
    "bio" TEXT,
    "disciplines" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "research_areas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "external_links" JSONB,
    "visibility" "AcademicProfileVisibility" NOT NULL DEFAULT 'PUBLIC',
    "contact_policy" "AcademicContactPolicy" NOT NULL DEFAULT 'VERIFIED_MEMBERS',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "academic_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_affiliations" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" TEXT NOT NULL,
    "unit_id" TEXT,
    "role" "Role" NOT NULL,
    "status" "AcademicAffiliationStatus" NOT NULL DEFAULT 'PENDING',
    "study_level" TEXT,
    "program" TEXT,
    "academic_year" TEXT,
    "position" TEXT,
    "message" TEXT,
    "decision_reason" TEXT,
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "academic_affiliations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "academic_institutions_organization_id_key" ON "academic_institutions"("organization_id");

-- CreateIndex
CREATE INDEX "academic_institutions_kind_idx" ON "academic_institutions"("kind");

-- CreateIndex
CREATE INDEX "academic_institutions_city_idx" ON "academic_institutions"("city");

-- CreateIndex
CREATE INDEX "academic_institutions_latitude_longitude_idx" ON "academic_institutions"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "academic_units_institution_id_kind_idx" ON "academic_units"("institution_id", "kind");

-- CreateIndex
CREATE INDEX "academic_units_parent_id_idx" ON "academic_units"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "academic_profiles_user_id_key" ON "academic_profiles"("user_id");

-- CreateIndex
CREATE INDEX "academic_profiles_visibility_idx" ON "academic_profiles"("visibility");

-- CreateIndex
CREATE INDEX "academic_affiliations_organization_id_status_created_at_idx" ON "academic_affiliations"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "academic_affiliations_user_id_status_idx" ON "academic_affiliations"("user_id", "status");

-- CreateIndex
CREATE INDEX "academic_affiliations_unit_id_idx" ON "academic_affiliations"("unit_id");

-- AddForeignKey
ALTER TABLE "academic_institutions" ADD CONSTRAINT "academic_institutions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_units" ADD CONSTRAINT "academic_units_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "academic_institutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_units" ADD CONSTRAINT "academic_units_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "academic_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_profiles" ADD CONSTRAINT "academic_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_affiliations" ADD CONSTRAINT "academic_affiliations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_affiliations" ADD CONSTRAINT "academic_affiliations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_affiliations" ADD CONSTRAINT "academic_affiliations_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "academic_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Défense en profondeur (convention du projet, contrôlée en CI) : RLS activée
-- sans politique ; aucun privilège pour anon/authenticated.
ALTER TABLE "academic_institutions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "academic_units" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "academic_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "academic_affiliations" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['academic_institutions', 'academic_units', 'academic_profiles', 'academic_affiliations'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;
