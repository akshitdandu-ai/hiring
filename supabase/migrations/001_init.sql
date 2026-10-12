-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Sources table
CREATE TABLE IF NOT EXISTS sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('rss', 'google_news', 'gnews')),
  url_or_query TEXT NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  last_fetched_at TIMESTAMPTZ,
  last_ok BOOLEAN DEFAULT TRUE,
  last_error TEXT,
  items_last_run INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_access" ON sources FOR ALL USING (FALSE);

-- Articles table
CREATE TABLE IF NOT EXISTS articles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  url TEXT NOT NULL,
  url_hash TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  title_norm TEXT,
  source_name TEXT,
  source_id UUID REFERENCES sources(id) ON DELETE SET NULL,
  summary TEXT,
  published_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  topic TEXT,
  week_key TEXT,
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'duplicate', 'excluded', 'pick', 'backup', 'used')),
  duplicate_of UUID REFERENCES articles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_access" ON articles FOR ALL USING (FALSE);

CREATE INDEX articles_week_key_status ON articles(week_key, status);
CREATE INDEX articles_fetched_at ON articles(fetched_at);
CREATE INDEX articles_url_hash ON articles(url_hash);

-- Issues table
CREATE TABLE IF NOT EXISTS issues (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  week_key TEXT NOT NULL UNIQUE,
  issue_number INT,
  subject TEXT,
  intro TEXT,
  status TEXT DEFAULT 'collecting' CHECK (status IN ('collecting', 'draft', 'in_review', 'confirmed', 'sending', 'sent', 'failed')),
  selection_notes JSONB,
  topics TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  sent_to_telegram_at TIMESTAMPTZ,
  reminder_sent_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  scheduled_for TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  recipients_total INT DEFAULT 0,
  recipients_sent INT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_access" ON issues FOR ALL USING (FALSE);

CREATE INDEX issues_status ON issues(status);
CREATE INDEX issues_scheduled_for ON issues(scheduled_for);

-- Issue items table
CREATE TABLE IF NOT EXISTS issue_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('pick', 'backup', 'removed')),
  position INT,
  rank INT,
  topic TEXT,
  why_selected TEXT,
  commentary TEXT,
  approved BOOLEAN DEFAULT FALSE,
  edited BOOLEAN DEFAULT FALSE,
  telegram_message_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE issue_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_access" ON issue_items FOR ALL USING (FALSE);

CREATE INDEX issue_items_issue_id ON issue_items(issue_id);
CREATE INDEX issue_items_article_id ON issue_items(article_id);

-- Style guide table
CREATE TABLE IF NOT EXISTS style_guide (
  id INT PRIMARY KEY DEFAULT 1,
  content TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE style_guide ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_access" ON style_guide FOR ALL USING (FALSE);

-- Subscribers table
CREATE TABLE IF NOT EXISTS subscribers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL UNIQUE COLLATE "C",
  name TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'unsubscribed', 'bounced')),
  unsubscribe_token TEXT UNIQUE,
  soft_bounce_count INT DEFAULT 0,
  last_bounce_at TIMESTAMPTZ,
  unsubscribed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  source TEXT DEFAULT 'signup' CHECK (source IN ('signup', 'import', 'admin')),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_access" ON subscribers FOR ALL USING (FALSE);

CREATE INDEX subscribers_email ON subscribers(email);
CREATE INDEX subscribers_status ON subscribers(status);

-- Send log table
CREATE TABLE IF NOT EXISTS send_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  subscriber_id UUID NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(issue_id, subscriber_id)
);

ALTER TABLE send_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_access" ON send_log FOR ALL USING (FALSE);

-- Processed mail table
CREATE TABLE IF NOT EXISTS processed_mail (
  message_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('bounce', 'unsubscribe_reply', 'ignored')),
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE processed_mail ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_access" ON processed_mail FOR ALL USING (FALSE);

-- Bot state table
CREATE TABLE IF NOT EXISTS bot_state (
  chat_id BIGINT PRIMARY KEY,
  awaiting TEXT,
  payload JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE bot_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_access" ON bot_state FOR ALL USING (FALSE);

-- Run logs table
CREATE TABLE IF NOT EXISTS run_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job TEXT NOT NULL,
  ok BOOLEAN NOT NULL,
  details JSONB,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE run_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_access" ON run_logs FOR ALL USING (FALSE);

CREATE INDEX run_logs_job_date ON run_logs(job, created_at DESC);
