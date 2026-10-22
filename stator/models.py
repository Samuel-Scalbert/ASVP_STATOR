"""Modèle de données SQL d'ASVP Stator.

Les comptages sont stockés dans stat_counts : une ligne par fiche × set × stat.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import (Boolean, CheckConstraint, Date, DateTime, ForeignKey, Integer, String, Text,
                        UniqueConstraint)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


db = SQLAlchemy(model_class=Base)


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Setting(db.Model):
    """Réglages de l'équipe (nom, saison) en clé / valeur."""
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")


class Player(db.Model):
    __tablename__ = "players"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)  # slug stable dérivé du nom, ex. "joueur-a"
    name: Mapped[str] = mapped_column(String(120))
    poste: Mapped[str | None] = mapped_column(String(20))  # clé de referentiel.json > roles
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Match(db.Model):
    __tablename__ = "matches"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    opponent: Mapped[str] = mapped_column(String(120))
    match_date: Mapped[date | None] = mapped_column(Date)
    venue: Mapped[str] = mapped_column(String(10), default="")  # "dom", "ext" ou ""
    competition: Mapped[str] = mapped_column(String(120), default="")
    video_url: Mapped[str] = mapped_column(String(300), default="")  # lien YouTube du match
    squad: Mapped[str] = mapped_column(Text, default="")  # joueurs du match : ids séparés par des virgules (vide = tout l'effectif)
    # Résultat en sets, utilisé seulement quand le détail des sets n'est pas connu.
    result_asvp: Mapped[int | None] = mapped_column(Integer)
    result_opp: Mapped[int | None] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    set_scores: Mapped[list[SetScore]] = relationship(
        back_populates="match", cascade="all, delete-orphan", order_by="SetScore.set_no")
    sheets: Mapped[list[StatSheet]] = relationship(back_populates="match", cascade="all, delete-orphan")


class SetScore(db.Model):
    __tablename__ = "set_scores"
    match_id: Mapped[str] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), primary_key=True)
    set_no: Mapped[int] = mapped_column(Integer, primary_key=True)
    asvp: Mapped[int] = mapped_column(Integer)
    opp: Mapped[int] = mapped_column(Integer)
    match: Mapped[Match] = relationship(back_populates="set_scores")

    __table_args__ = (CheckConstraint("set_no BETWEEN 1 AND 5", name="ck_set_scores_set_no"),)


class StatField(db.Model):
    """Copie SQL du référentiel (web/referentiel.json), resynchronisée au démarrage."""
    __tablename__ = "stat_fields"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)  # "<geste>.<stat>", ex. "attaque.decisive_p4"
    skill: Mapped[str] = mapped_column(String(30))
    skill_label: Mapped[str] = mapped_column(String(60))
    field_key: Mapped[str] = mapped_column(String(50))
    outcome: Mapped[str] = mapped_column(String(30))
    outcome_label: Mapped[str] = mapped_column(String(60))
    court_position: Mapped[int | None] = mapped_column(Integer)  # poste 2, 3 ou 4 au filet
    level: Mapped[int] = mapped_column(Integer)                  # 1 = meilleur … 4 = faute
    points: Mapped[int] = mapped_column(Integer, default=0)      # +1 point marqué, −1 faute, 0 sinon
    is_success: Mapped[bool] = mapped_column(Boolean, default=False)  # compte au numérateur du taux
    excel_row: Mapped[int | None] = mapped_column(Integer)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    in_referentiel: Mapped[bool] = mapped_column(Boolean, default=True)


class StatSheet(db.Model):
    """La fiche d'un joueur pour un match : ses bilans, et ses comptages dans stat_counts."""
    __tablename__ = "stat_sheets"
    id: Mapped[str] = mapped_column(String(170), primary_key=True)  # "<match_id>__<player_id>"
    match_id: Mapped[str] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    player_id: Mapped[str] = mapped_column(ForeignKey("players.id"), index=True)
    bilan_perso_plus: Mapped[str] = mapped_column(Text, default="")
    bilan_perso_moins: Mapped[str] = mapped_column(Text, default="")
    bilan_collectif_plus: Mapped[str] = mapped_column(Text, default="")
    bilan_collectif_moins: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    match: Mapped[Match] = relationship(back_populates="sheets")
    player: Mapped[Player] = relationship()
    counts: Mapped[list[StatCount]] = relationship(back_populates="sheet", cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint("match_id", "player_id", name="uq_stat_sheets_match_player"),)


class StatCount(db.Model):
    __tablename__ = "stat_counts"
    sheet_id: Mapped[str] = mapped_column(ForeignKey("stat_sheets.id", ondelete="CASCADE"), primary_key=True)
    set_no: Mapped[int] = mapped_column(Integer, primary_key=True)
    field_id: Mapped[str] = mapped_column(ForeignKey("stat_fields.id"), primary_key=True)
    count: Mapped[int] = mapped_column(Integer)
    sheet: Mapped[StatSheet] = relationship(back_populates="counts")

    __table_args__ = (
        CheckConstraint("count > 0", name="ck_stat_counts_count"),
        CheckConstraint("set_no BETWEEN 1 AND 5", name="ck_stat_counts_set_no"),
    )
