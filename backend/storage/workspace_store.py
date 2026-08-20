"""工作台存储（0.1.5 B2：从 sqlite_store 拆出）。

素材组 / 素材篮 / 回应历史三族方法，以 Mixin 回挂 SqliteStore（共用同一连接与
事务语义，调用方 API 零改动）；表结构仍统一在 sqlite_store._SCHEMA。
"""
from __future__ import annotations


class WorkspaceMixin:
    """素材组（material_groups）+ 素材篮（basket）+ 回应历史（responses）。"""

    conn = None   # 由 SqliteStore.__init__ 提供

    # ---------- 素材组（0.1.4 批 4：素材篮升级，存储无上限、注入预算 20） ----------
    BASKET_CAP = 20          # 仅作单次注入预算展示（prompt 物理限制），不限存储
    PUBLIC_GROUP = "公共素材组"   # 永置顶，不可删改；删组时材料归这里（无孤儿）

    def _ensure_public_group(self) -> int:
        row = self.conn.execute(
            "SELECT id FROM material_groups WHERE pinned=1").fetchone()
        if row:
            return row["id"]
        cur = self.conn.execute(
            "INSERT INTO material_groups(name, pinned, created_at) "
            "VALUES (?,1,datetime('now','localtime'))", (self.PUBLIC_GROUP,))
        self.conn.commit()
        return cur.lastrowid

    def public_group_id(self) -> int:
        return self._ensure_public_group()

    def group_list(self) -> list[dict]:
        """全部组（公共置顶）+ 每组素材计数。"""
        self._ensure_public_group()
        rows = self.conn.execute(
            "SELECT g.*, (SELECT COUNT(*) FROM basket b WHERE b.group_id=g.id) "
            "AS count FROM material_groups g "
            "ORDER BY g.pinned DESC, g.id").fetchall()
        return [dict(r) for r in rows]

    def group_add(self, name: str) -> dict:
        name = name.strip()
        if not name:
            raise ValueError("组名不能为空")
        if self.conn.execute("SELECT 1 FROM material_groups WHERE name=?",
                             (name,)).fetchone():
            raise ValueError(f"组「{name}」已存在")
        cur = self.conn.execute(
            "INSERT INTO material_groups(name, pinned, created_at) "
            "VALUES (?,0,datetime('now','localtime'))", (name,))
        self.conn.commit()
        return {"id": cur.lastrowid, "name": name}

    def group_rename(self, group_id: int, name: str) -> int:
        row = self.conn.execute("SELECT pinned FROM material_groups WHERE id=?",
                                (group_id,)).fetchone()
        if row is None:
            raise ValueError("组不存在")
        if row["pinned"]:
            raise ValueError("公共素材组不可改名")
        cur = self.conn.execute("UPDATE material_groups SET name=? WHERE id=?",
                                (name.strip(), group_id))
        self.conn.commit()
        return cur.rowcount

    def group_delete(self, group_id: int) -> dict:
        """删组不删料：组内素材并入公共素材组（决策 15）。"""
        row = self.conn.execute("SELECT pinned FROM material_groups WHERE id=?",
                                (group_id,)).fetchone()
        if row is None:
            raise ValueError("组不存在")
        if row["pinned"]:
            raise ValueError("公共素材组不可删除")
        pub = self._ensure_public_group()
        moved = self.conn.execute(
            "UPDATE basket SET group_id=? WHERE group_id=?",
            (pub, group_id)).rowcount
        self.conn.execute("DELETE FROM material_groups WHERE id=?", (group_id,))
        self.conn.commit()
        return {"moved": moved}

    # ---------- 素材篮 ----------
    def basket_add(self, item_type: str, ref_id: str, excerpt: str,
                   source: str = "", group_id: int | None = None) -> dict:
        gid = group_id or self._ensure_public_group()
        cur = self.conn.execute(
            "INSERT OR IGNORE INTO basket(item_type, ref_id, excerpt, source, "
            "group_id, added_at) VALUES (?,?,?,?,?,datetime('now','localtime'))",
            (item_type, ref_id, excerpt[:800], source, gid))
        self.conn.commit()
        return {"id": cur.lastrowid, "duplicated": cur.rowcount == 0}

    def basket_list(self) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM basket ORDER BY id DESC").fetchall()
        return [dict(r) for r in rows]

    def basket_remove(self, item_id: int | None = None) -> int:
        """指定 id 删单条；不传 = 清空。"""
        if item_id is None:
            cur = self.conn.execute("DELETE FROM basket")
        else:
            cur = self.conn.execute("DELETE FROM basket WHERE id=?", (item_id,))
        self.conn.commit()
        return cur.rowcount

    def basket_mark_used(self, ids: list[int]) -> None:
        self.conn.executemany("UPDATE basket SET used=1 WHERE id=?",
                              [(i,) for i in ids])
        self.conn.commit()

    # ---------- 回应历史（项目19：五意图输出全记录，含收藏） ----------
    def response_add(self, intent: str, input_text: str, output_text: str,
                     citations_json: str = "[]", provider: str = "",
                     stance: str = "") -> int:
        cur = self.conn.execute(
            "INSERT INTO responses(intent, stance, input_text, output_text, "
            "citations_json, provider, created_at) "
            "VALUES (?,?,?,?,?,?,datetime('now','localtime'))",
            (intent, stance, input_text[:2000], output_text, citations_json,
             provider))
        self.conn.commit()
        return cur.lastrowid

    def response_list(self, limit: int = 100) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM responses ORDER BY starred DESC, id DESC LIMIT ?",
            (limit,)).fetchall()
        return [dict(r) for r in rows]

    def response_star(self, resp_id: int, starred: bool) -> int:
        cur = self.conn.execute("UPDATE responses SET starred=? WHERE id=?",
                                (1 if starred else 0, resp_id))
        self.conn.commit()
        return cur.rowcount

    def response_delete(self, resp_id: int) -> int:
        cur = self.conn.execute("DELETE FROM responses WHERE id=?", (resp_id,))
        self.conn.commit()
        return cur.rowcount
