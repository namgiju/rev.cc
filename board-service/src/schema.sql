BEGIN;
-- 이전 가입일을 추정하지 않는다. 신규 가입일은 Spring User가 기록한다.
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS board_posts (
 id SERIAL PRIMARY KEY, title VARCHAR(150) NOT NULL, content TEXT NOT NULL,
 author_id BIGINT NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS category VARCHAR(20) NOT NULL DEFAULT 'free';
ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS vehicle VARCHAR(100) NOT NULL DEFAULT '';
ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS image_ids INTEGER[] NOT NULL DEFAULT '{}';
ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS views INTEGER NOT NULL DEFAULT 0;
ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS community_images (
 id SERIAL PRIMARY KEY, owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 mime VARCHAR(30) NOT NULL, data BYTEA NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS board_comments (
 id SERIAL PRIMARY KEY, post_id INTEGER NOT NULL REFERENCES board_posts(id) ON DELETE CASCADE,
 author_id BIGINT NOT NULL REFERENCES users(id), parent_id INTEGER REFERENCES board_comments(id) ON DELETE CASCADE,
 content VARCHAR(2000) NOT NULL, deleted BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS board_likes (
 post_id INTEGER NOT NULL REFERENCES board_posts(id) ON DELETE CASCADE,
 user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(post_id,user_id)
);
CREATE TABLE IF NOT EXISTS board_bookmarks (
 post_id INTEGER NOT NULL REFERENCES board_posts(id) ON DELETE CASCADE,
 user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(post_id,user_id)
);
CREATE TABLE IF NOT EXISTS owner_vehicles (
 id SERIAL PRIMARY KEY, owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 model VARCHAR(100) NOT NULL, year INTEGER NOT NULL CHECK(year BETWEEN 1900 AND 2100),
 trim VARCHAR(100) NOT NULL DEFAULT '', bio VARCHAR(1000) NOT NULL DEFAULT '',
 image_id INTEGER REFERENCES community_images(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE owner_vehicles ADD COLUMN IF NOT EXISTS manufacturer VARCHAR(100) NOT NULL DEFAULT '';
ALTER TABLE owner_vehicles ADD COLUMN IF NOT EXISTS transmission VARCHAR(50) NOT NULL DEFAULT '';
ALTER TABLE owner_vehicles ADD COLUMN IF NOT EXISTS color VARCHAR(100) NOT NULL DEFAULT '';
ALTER TABLE owner_vehicles ADD COLUMN IF NOT EXISTS nickname VARCHAR(100) NOT NULL DEFAULT '';
ALTER TABLE owner_vehicles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- 오너 인증(자동차등록증 검토) 상태. verification_status는 신청 전이면 NULL이다.
ALTER TABLE owner_vehicles ADD COLUMN IF NOT EXISTS license_plate VARCHAR(20) NOT NULL DEFAULT '';
ALTER TABLE owner_vehicles ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE owner_vehicles ADD COLUMN IF NOT EXISTS verification_status VARCHAR(20);
ALTER TABLE owner_vehicles ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='owner_vehicles'::regclass AND conname='owner_vehicles_image_id_fkey') THEN
  ALTER TABLE owner_vehicles ADD CONSTRAINT owner_vehicles_image_id_fkey FOREIGN KEY(image_id) REFERENCES community_images(id);
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS vehicle_records (
 id SERIAL PRIMARY KEY, vehicle_id INTEGER NOT NULL REFERENCES owner_vehicles(id) ON DELETE CASCADE,
 kind VARCHAR(20) NOT NULL, title VARCHAR(150) NOT NULL, content VARCHAR(2000) NOT NULL DEFAULT '',
 mileage INTEGER CHECK(mileage BETWEEN 0 AND 2000000), cost INTEGER CHECK(cost BETWEEN 0 AND 2000000000),
 recorded_on DATE NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS community_notifications (
 id SERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 actor_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 post_id INTEGER NOT NULL REFERENCES board_posts(id) ON DELETE CASCADE,
 kind VARCHAR(20) NOT NULL, is_read BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS community_reports (
 id SERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 post_id INTEGER NOT NULL REFERENCES board_posts(id) ON DELETE CASCADE,
 reason VARCHAR(500) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'pending',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(user_id,post_id)
);
CREATE INDEX IF NOT EXISTS board_posts_category_id ON board_posts(category,id DESC);
CREATE INDEX IF NOT EXISTS board_posts_author_id ON board_posts(author_id,id DESC);
CREATE INDEX IF NOT EXISTS board_comments_post ON board_comments(post_id,id);
CREATE INDEX IF NOT EXISTS community_notifications_user ON community_notifications(user_id,id DESC);
CREATE INDEX IF NOT EXISTS owner_vehicles_owner ON owner_vehicles(owner_id,id);
-- 자동차등록증 원본. community_images(공개 게시글 사진)와 완전히 분리된 테이블로,
-- 소유자 본인과 관리자만 조회할 수 있도록 Spring 쪽에서 접근을 제한한다.
CREATE TABLE IF NOT EXISTS vehicle_verifications (
 id SERIAL PRIMARY KEY, vehicle_id INTEGER NOT NULL REFERENCES owner_vehicles(id) ON DELETE CASCADE,
 status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
 document_mime VARCHAR(30) NOT NULL, document_data BYTEA NOT NULL,
 requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 reviewed_at TIMESTAMPTZ, reviewed_by BIGINT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS vehicle_verifications_vehicle ON vehicle_verifications(vehicle_id,id DESC);
CREATE INDEX IF NOT EXISTS vehicle_verifications_status ON vehicle_verifications(status,id DESC);
-- Optional personal settings; authentication and login names remain in users.
CREATE TABLE IF NOT EXISTS member_profiles (
 user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 bio VARCHAR(300) NOT NULL DEFAULT '',
 avatar_image_id INTEGER REFERENCES community_images(id) ON DELETE SET NULL,
 cover_image_id INTEGER REFERENCES community_images(id) ON DELETE SET NULL,
 representative_vehicle_id INTEGER REFERENCES owner_vehicles(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS garage_guestbook (
 id SERIAL PRIMARY KEY,
 owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 author_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 content VARCHAR(1000) NOT NULL CHECK(length(btrim(content)) > 0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS garage_guestbook_owner ON garage_guestbook(owner_id,id DESC);
-- Marketplace listings are not community posts; reuse members and public image uploads.
CREATE TABLE IF NOT EXISTS parts_listings (
 id SERIAL PRIMARY KEY,
 seller_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title VARCHAR(150) NOT NULL,
 description VARCHAR(5000) NOT NULL,
 price BIGINT NOT NULL CHECK(price BETWEEN 0 AND 2000000000),
 category VARCHAR(30) NOT NULL CHECK(category IN ('wheels','suspension','brakes','intake-exhaust','exterior','interior','electronics','engine','other')),
 status VARCHAR(15) NOT NULL DEFAULT 'selling' CHECK(status IN ('selling','reserved','sold')),
 image_ids INTEGER[] NOT NULL DEFAULT '{}',
 vehicle VARCHAR(200) NOT NULL,
 region VARCHAR(100) NOT NULL,
 contact VARCHAR(300) NOT NULL,
 views INTEGER NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS parts_favorites (
 listing_id INTEGER NOT NULL REFERENCES parts_listings(id) ON DELETE CASCADE,
 user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 PRIMARY KEY(listing_id,user_id)
);
CREATE INDEX IF NOT EXISTS parts_listings_seller ON parts_listings(seller_id,id DESC);
CREATE INDEX IF NOT EXISTS parts_listings_category_status ON parts_listings(category,status,id DESC);
CREATE INDEX IF NOT EXISTS parts_favorites_user ON parts_favorites(user_id,listing_id);
COMMIT;
