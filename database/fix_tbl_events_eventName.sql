-- Fix legacy tbl_events so new Events API can insert rows.
-- Run once on the Daily/school database used by port 90.

ALTER TABLE tbl_events
  MODIFY COLUMN eventName VARCHAR(255) NULL DEFAULT NULL;

-- Optional: relax other legacy NOT NULL columns if they also block inserts
-- ALTER TABLE tbl_events MODIFY COLUMN fromDate DATE NULL;
-- ALTER TABLE tbl_events MODIFY COLUMN toDate DATE NULL;
-- ALTER TABLE tbl_events MODIFY COLUMN content TEXT NULL;
-- ALTER TABLE tbl_events MODIFY COLUMN photoUrl VARCHAR(500) NULL;
