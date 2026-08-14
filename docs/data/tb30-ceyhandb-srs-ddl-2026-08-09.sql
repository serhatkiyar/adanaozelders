-- TB-30 KANITI — ceyhandb `srs_*` şeması, DÜŞÜRÜLMEDEN ÖNCE (9 Ağu 2026)
--
-- Bu döküm, `ensure_schema`'nın gerçek geliştirme veritabanına YAZDIĞI şemadır.
-- Alındığı an ceyhandb şu ayrışmış durumdaydı:
--
--   alembic_version = ip12_urun_arama_vektoru   (İP-16 ÖNCESİ)
--   srs_* tabloları  = 8 tanesi de MEVCUT       (İP-16 şeması)
--   `alembic upgrade head` -> DuplicateTableError: relation "srs_decks" already exists
--
-- Yani tablolar yazılmış, damga sonradan eski dalın `stamp head --purge`
-- guard'ıyla ip12'ye geri sarılmıştı. Tablolar boştu (8 tabloda 0 satır) ve
-- dışarıdan hiçbir FK/view bağımlılığı yoktu; bu yüzden düşürülüp şema
-- migration'ın kendisine yeniden kurduruldu.
--
-- KARŞILAŞTIRMA SONUCU (bu döküm ile migration'ın ürettiği şema):
--   FARK YOK. 655 satırın tamamı birebir aynı — kolon tipi, index, constraint,
--   sequence, FK dahil. Tek fark pg_dump 17'nin her çağrıda ürettiği rastgele
--   \restrict / \unrestrict nonce'ları (şemanın parçası değildir).
--
-- TB-30 için anlamı: `ensure_schema` bu vakada ŞEMAYI BOZMADI, yalnız DAMGAYI
-- bozdu. Sapma yok, ayrışma var. Ama bu ancak ölçülerek bilinebilirdi —
-- damga yanlışken "tablolar da doğru mudur" sorusunun cevabı önden bilinemez.
--
-- PostgreSQL database dump
--

\restrict GgvMY3LJw29gJOXFkGVLzK2WXx1wg7H7a7R6BadIc8GNI3dJm5fHk5ZsejMHhRf

-- Dumped from database version 17.8
-- Dumped by pg_dump version 17.8

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: srs_cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.srs_cards (
    id integer NOT NULL,
    note_id integer NOT NULL,
    deck_id integer NOT NULL,
    template_ord integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: srs_cards_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.srs_cards_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: srs_cards_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.srs_cards_id_seq OWNED BY public.srs_cards.id;


--
-- Name: srs_deck_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.srs_deck_assignments (
    id integer NOT NULL,
    deck_id integer NOT NULL,
    client_id integer NOT NULL,
    assigned_by_tutor_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: srs_deck_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.srs_deck_assignments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: srs_deck_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.srs_deck_assignments_id_seq OWNED BY public.srs_deck_assignments.id;


--
-- Name: srs_decks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.srs_decks (
    id integer NOT NULL,
    owner_user_id integer NOT NULL,
    owner_role_id integer NOT NULL,
    parent_id integer,
    name character varying(200) NOT NULL,
    description text,
    visibility character varying(10) DEFAULT 'PRIVATE'::character varying NOT NULL,
    new_per_day integer,
    reviews_per_day integer,
    copied_from_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT ck_srs_decks_visibility CHECK (((visibility)::text = ANY ((ARRAY['PRIVATE'::character varying, 'PLATFORM'::character varying])::text[])))
);


--
-- Name: srs_decks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.srs_decks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: srs_decks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.srs_decks_id_seq OWNED BY public.srs_decks.id;


--
-- Name: srs_note_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.srs_note_tags (
    id integer NOT NULL,
    note_id integer NOT NULL,
    tag_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: srs_note_tags_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.srs_note_tags_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: srs_note_tags_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.srs_note_tags_id_seq OWNED BY public.srs_note_tags.id;


--
-- Name: srs_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.srs_notes (
    id integer NOT NULL,
    deck_id integer NOT NULL,
    note_type character varying(20) NOT NULL,
    front text NOT NULL,
    back text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT ck_srs_notes_note_type CHECK (((note_type)::text = ANY ((ARRAY['BASIC'::character varying, 'BASIC_REVERSED'::character varying, 'CLOZE'::character varying, 'TYPE_IN'::character varying])::text[])))
);


--
-- Name: srs_notes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.srs_notes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: srs_notes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.srs_notes_id_seq OWNED BY public.srs_notes.id;


--
-- Name: srs_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.srs_progress (
    id integer NOT NULL,
    card_id integer NOT NULL,
    user_id integer NOT NULL,
    role_id integer NOT NULL,
    state character varying(20) DEFAULT 'NEW'::character varying NOT NULL,
    step integer,
    stability double precision,
    difficulty double precision,
    due_at timestamp with time zone,
    last_review_at timestamp with time zone,
    reps integer DEFAULT 0 NOT NULL,
    lapses integer DEFAULT 0 NOT NULL,
    suspended_at timestamp with time zone,
    buried_until timestamp with time zone,
    is_leech boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT ck_srs_progress_state CHECK (((state)::text = ANY ((ARRAY['NEW'::character varying, 'LEARNING'::character varying, 'REVIEW'::character varying, 'RELEARNING'::character varying])::text[])))
);


--
-- Name: srs_progress_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.srs_progress_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: srs_progress_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.srs_progress_id_seq OWNED BY public.srs_progress.id;


--
-- Name: srs_review_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.srs_review_logs (
    id integer NOT NULL,
    progress_id integer NOT NULL,
    user_id integer NOT NULL,
    role_id integer NOT NULL,
    rating integer NOT NULL,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    study_day date NOT NULL,
    client_token uuid,
    introduced_new boolean DEFAULT false NOT NULL,
    undone_at timestamp with time zone,
    prev_state character varying(20),
    prev_step integer,
    prev_stability double precision,
    prev_difficulty double precision,
    prev_due_at timestamp with time zone,
    prev_last_review_at timestamp with time zone,
    prev_reps integer DEFAULT 0 NOT NULL,
    prev_lapses integer DEFAULT 0 NOT NULL,
    prev_is_leech boolean DEFAULT false NOT NULL,
    prev_suspended_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT ck_srs_review_logs_rating CHECK (((rating >= 1) AND (rating <= 4)))
);


--
-- Name: srs_review_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.srs_review_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: srs_review_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.srs_review_logs_id_seq OWNED BY public.srs_review_logs.id;


--
-- Name: srs_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.srs_tags (
    id integer NOT NULL,
    owner_user_id integer NOT NULL,
    owner_role_id integer NOT NULL,
    name character varying(100) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: srs_tags_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.srs_tags_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: srs_tags_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.srs_tags_id_seq OWNED BY public.srs_tags.id;


--
-- Name: srs_cards id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.srs_cards ALTER COLUMN id SET DEFAULT nextval('public.srs_cards_id_seq'::regclass);


--
-- Name: srs_deck_assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.srs_deck_assignments ALTER COLUMN id SET DEFAULT nextval('public.srs_deck_assignments_id_seq'::regclass);


--
-- Name: srs_decks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.srs_decks ALTER COLUMN id SET DEFAULT nextval('public.srs_decks_id_seq'::regclass);


--
-- Name: srs_note_tags id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.srs_note_tags ALTER COLUMN id SET DEFAULT nextval('public.srs_note_tags_id_seq'::regclass);


--
-- Name: srs_notes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.srs_notes ALTER COLUMN id SET DEFAULT nextval('public.srs_notes_id_seq'::regclass);


--
-- Name: srs_progress id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.srs_progress ALTER COLUMN id SET DEFAULT nextval('public.srs_progress_id_seq'::regclass);


--
-- Name: srs_review_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.srs_review_logs ALTER COLUMN id SET DEFAULT nextval('public.srs_review_logs_id_seq'::regclass);


--
-- Name: srs_tags id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.srs_tags ALTER COLUMN id SET DEFAULT nextval('public.srs_tags_id_seq'::regclass);


--
-- Name: srs_cards srs_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.srs_cards
    ADD CONSTRAINT srs_cards_pkey PRIMARY KEY (id);


--
-- Name: srs_deck_assignments srs_deck_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.srs_deck_assignments
    ADD CONSTRAINT srs_deck_assignments_pkey PRIMARY KEY (id);


--
-- Name: srs_decks srs_decks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.srs_decks
    ADD CONSTRAINT srs_decks_pkey PRIMARY KEY (id);


--
-- Name: srs_note_tags srs_note_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.srs_note_tags
    ADD CONSTRAINT srs_note_tags_pkey PRIMARY KEY (id);


--
-- Name: srs_notes srs_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.srs_notes
    ADD CONSTRAINT srs_notes_pkey PRIMARY KEY (id);


--
-- Name: srs_progress srs_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.srs_progress
    ADD CONSTRAINT srs_progress_pkey PRIMARY KEY (id);


--
-- Name: srs_review_logs srs_review_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.srs_review_logs
    ADD CONSTRAINT srs_review_logs_pkey PRIMARY KEY (id);


--
-- Name: srs_tags srs_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.srs_tags
    ADD CONSTRAINT srs_tags_pkey PRIMARY KEY (id);


--
-- Name: ix_srs_cards_deck; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_srs_cards_deck ON public.srs_cards USING btree (deck_id);


--
-- Name: ix_srs_decks_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_srs_decks_owner ON public.srs_decks USING btree (owner_user_id, owner_role_id);


--
-- Name: ix_srs_note_tags_tag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_srs_note_tags_tag ON public.srs_note_tags USING btree (tag_id);


--
-- Name: ix_srs_notes_deck; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_srs_notes_deck ON public.srs_notes USING btree (deck_id);


--
-- Name: ix_srs_progress_user_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_srs_progress_user_due ON public.srs_progress USING btree (user_id, role_id, due_at);


--
-- Name: ix_srs_review_logs_progress; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_srs_review_logs_progress ON public.srs_review_logs USING btree (progress_id);


--
-- Name: ix_srs_review_logs_user_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_srs_review_logs_user_day ON public.srs_review_logs USING btree (user_id, role_id, study_day);


--
-- Name: uq_srs_cards_note_ord; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_srs_cards_note_ord ON public.srs_cards USING btree (note_id, template_ord);


--
-- Name: uq_srs_deck_assignments_deck_client; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_srs_deck_assignments_deck_client ON public.srs_deck_assignments USING btree (deck_id, client_id);


--
-- Name: uq_srs_note_tags_note_tag; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_srs_note_tags_note_tag ON public.srs_note_tags USING btree (note_id, tag_id);


--
-- Name: uq_srs_progress_card_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_srs_progress_card_user ON public.srs_progress USING btree (card_id, user_id, role_id);


--
-- Name: uq_srs_review_logs_client_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_srs_review_logs_client_token ON public.srs_review_logs USING btree (user_id, role_id, client_token) WHERE (client_token IS NOT NULL);


--
-- Name: uq_srs_tags_owner_lower_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_srs_tags_owner_lower_name ON public.srs_tags USING btree (owner_user_id, owner_role_id, lower((name)::text));


--
-- Name: srs_cards srs_cards_deck_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.srs_cards
    ADD CONSTRAINT srs_cards_deck_id_fkey FOREIGN KEY (deck_id) REFERENCES public.srs_decks(id);


--
-- Name: srs_cards srs_cards_note_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.srs_cards
    ADD CONSTRAINT srs_cards_note_id_fkey FOREIGN KEY (note_id) REFERENCES public.srs_notes(id);


--
-- Name: srs_deck_assignments srs_deck_assignments_assigned_by_tutor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.srs_deck_assignments
    ADD CONSTRAINT srs_deck_assignments_assigned_by_tutor_id_fkey FOREIGN KEY (assigned_by_tutor_id) REFERENCES public.tutors(id);


--
-- Name: srs_deck_assignments srs_deck_assignments_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.srs_deck_assignments
    ADD CONSTRAINT srs_deck_assignments_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);


--
-- Name: srs_deck_assignments srs_deck_assignments_deck_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.srs_deck_assignments
    ADD CONSTRAINT srs_deck_assignments_deck_id_fkey FOREIGN KEY (deck_id) REFERENCES public.srs_decks(id);


--
-- Name: srs_decks srs_decks_copied_from_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.srs_decks
    ADD CONSTRAINT srs_decks_copied_from_id_fkey FOREIGN KEY (copied_from_id) REFERENCES public.srs_decks(id) ON DELETE SET NULL;


--
-- Name: srs_decks srs_decks_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.srs_decks
    ADD CONSTRAINT srs_decks_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.srs_decks(id);


--
-- Name: srs_note_tags srs_note_tags_note_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.srs_note_tags
    ADD CONSTRAINT srs_note_tags_note_id_fkey FOREIGN KEY (note_id) REFERENCES public.srs_notes(id) ON DELETE CASCADE;


--
-- Name: srs_note_tags srs_note_tags_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.srs_note_tags
    ADD CONSTRAINT srs_note_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.srs_tags(id) ON DELETE CASCADE;


--
-- Name: srs_notes srs_notes_deck_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.srs_notes
    ADD CONSTRAINT srs_notes_deck_id_fkey FOREIGN KEY (deck_id) REFERENCES public.srs_decks(id);


--
-- Name: srs_progress srs_progress_card_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.srs_progress
    ADD CONSTRAINT srs_progress_card_id_fkey FOREIGN KEY (card_id) REFERENCES public.srs_cards(id);


--
-- Name: srs_review_logs srs_review_logs_progress_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.srs_review_logs
    ADD CONSTRAINT srs_review_logs_progress_id_fkey FOREIGN KEY (progress_id) REFERENCES public.srs_progress(id);


--
-- PostgreSQL database dump complete
--

\unrestrict GgvMY3LJw29gJOXFkGVLzK2WXx1wg7H7a7R6BadIc8GNI3dJm5fHk5ZsejMHhRf

