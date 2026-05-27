-- AlterEnum: Add RULE_PARSING mode to ReviewMode enum
ALTER TYPE "ReviewMode" ADD VALUE IF NOT EXISTS 'RULE_PARSING';
