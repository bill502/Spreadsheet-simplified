-- Initial schema for people table and helpful indices.
-- Note: SQLite identifiers are case-insensitive; avoid duplicate names with different casing.
CREATE TABLE IF NOT EXISTS people (
  rowNumber INTEGER PRIMARY KEY,
  [new ID] TEXT,
  [ID] TEXT,
  [LAWYERNAME] TEXT,
  [PHONE] TEXT,
  [ADDRESS] TEXT,
  [LocalityName] TEXT,
  [Alias] TEXT,
  [HighlightedAddress] TEXT,
  [PP] TEXT,
  [UC] TEXT,
  [Comments] TEXT,
  [Status] TEXT,
  [Called] INTEGER,
  [CallDate] TEXT,
  [Visited] INTEGER,
  [VisitDate] TEXT,
  [ConfirmedVoter] INTEGER,
  [LawyerForum] TEXT
);

CREATE INDEX IF NOT EXISTS idx_people_uc ON people([UC]);
CREATE INDEX IF NOT EXISTS idx_people_pp ON people([PP]);
CREATE INDEX IF NOT EXISTS idx_people_locality ON people([LocalityName]);
