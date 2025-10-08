-- Initial schema for people table and helpful indices.
CREATE TABLE IF NOT EXISTS people (
  rowNumber INTEGER PRIMARY KEY,
  [new ID] TEXT, [ID] TEXT,
  [LAWYERNAME] TEXT,
  [PHONE] TEXT, [Phone] TEXT,
  [ADDRESS] TEXT, [Address] TEXT,
  [LocalityName] TEXT, [Locality] TEXT,
  [PP] TEXT, [UC] TEXT,
  [Comments] TEXT,
  [Status] TEXT,
  [Called] INTEGER, [CallDate] TEXT,
  [Visited] INTEGER, [VisitDate] TEXT,
  [ConfirmedVoter] INTEGER,
  [LawyerForum] TEXT
);

CREATE INDEX IF NOT EXISTS idx_people_uc ON people([UC]);
CREATE INDEX IF NOT EXISTS idx_people_pp ON people([PP]);
CREATE INDEX IF NOT EXISTS idx_people_locality ON people([LocalityName]);

