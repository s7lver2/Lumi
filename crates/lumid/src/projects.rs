//! La regla de quién puede tocar qué, en un solo sitio.
//!
//! Todo lo que toca un caso, una imagen o un análisis resuelve hacia arriba
//! hasta su proyecto y pasa por `access`. Es el mismo criterio que
//! `limits::effective`: la regla vive en una función o se desincroniza.

use crate::store::Store;

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Role {
    Owner,
    Member,
}

impl Role {
    /// Renombrar y borrar el proyecto, y gestionar quién entra. Todo lo demás
    /// —crear casos, subir imágenes, lanzar análisis, borrarlos— lo puede
    /// hacer cualquier miembro.
    pub fn manages(self) -> bool {
        self == Role::Owner
    }
}

/// El papel del usuario en el proyecto, o `None` si no tiene ninguno.
///
/// Una invitación `pending` NO da acceso: es una invitación, no una entrada
/// por la puerta de atrás. Se vuelve `Some` en cuanto la acepta desde
/// `/v1/me/invites`.
pub fn access(s: &Store, user_id: i64, project_id: i64) -> Option<Role> {
    let role: String = s
        .conn()
        .query_row(
            "SELECT role FROM project_members
             WHERE project_id = ?1 AND user_id = ?2 AND status = 'accepted'",
            rusqlite::params![project_id, user_id],
            |r| r.get(0),
        )
        .ok()?;
    match role.as_str() {
        "owner" => Some(Role::Owner),
        "member" => Some(Role::Member),
        _ => None,
    }
}

fn parent(s: &Store, sql: &str, id: i64) -> Option<i64> {
    s.conn().query_row(sql, [id], |r| r.get(0)).ok()
}

pub fn project_of_case(s: &Store, case_id: i64) -> Option<i64> {
    parent(s, "SELECT project_id FROM cases WHERE id = ?1", case_id)
}

pub fn project_of_image(s: &Store, image_id: i64) -> Option<i64> {
    parent(
        s,
        "SELECT c.project_id FROM images i JOIN cases c ON c.id = i.case_id WHERE i.id = ?1",
        image_id,
    )
}

pub fn project_of_analysis(s: &Store, analysis_id: i64) -> Option<i64> {
    parent(
        s,
        "SELECT c.project_id FROM analyses a JOIN cases c ON c.id = a.case_id WHERE a.id = ?1",
        analysis_id,
    )
}

/// Bytes que este usuario ha subido, en TODOS sus proyectos.
///
/// `max_storage_gb` es un límite por usuario, no por proyecto: en un proyecto
/// compartido cada imagen pesa en la cuota de quien la subió. Cargarla al
/// dueño del proyecto convertiría invitar a alguien en un riesgo para tu
/// propia cuota.
pub fn used_bytes(s: &Store, user_id: i64) -> i64 {
    s.conn()
        .query_row(
            "SELECT COALESCE(SUM(bytes), 0) FROM images WHERE uploader_id = ?1",
            [user_id],
            |r| r.get(0),
        )
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("lumi-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn el_invitado_ve_pero_no_gobierna_y_el_extrano_no_ve_nada() {
        let dir = tmp("acc");
        let s = Store::open(&dir).unwrap();
        {
            let c = s.conn();
            c.execute("INSERT INTO projects (id, name, created_at, updated_at) VALUES (1, 'p', 0, 0)", [])
                .unwrap();
            c.execute(
                "INSERT INTO project_members (project_id, user_id, role, added_at)
                 VALUES (1, 10, 'owner', 0), (1, 20, 'member', 0)",
                [],
            )
            .unwrap();
            c.execute("INSERT INTO cases (id, project_id, name, created_at) VALUES (5, 1, 'c', 0)", [])
                .unwrap();
            c.execute(
                "INSERT INTO images (id, case_id, uploader_id, filename, bytes, sha256, mime, created_at)
                 VALUES (7, 5, 20, 'a.jpg', 300, 'x', 'image/jpeg', 0)",
                [],
            )
            .unwrap();
        }

        // El dueño gobierna, el invitado no, y quien no es miembro no existe.
        assert_eq!(access(&s, 10, 1), Some(Role::Owner));
        assert!(access(&s, 10, 1).unwrap().manages());
        assert_eq!(access(&s, 20, 1), Some(Role::Member));
        assert!(!access(&s, 20, 1).unwrap().manages());
        assert_eq!(access(&s, 30, 1), None);

        // Resolver hacia arriba desde caso e imagen llega al mismo proyecto.
        assert_eq!(project_of_case(&s, 5), Some(1));
        assert_eq!(project_of_image(&s, 7), Some(1));
        assert_eq!(project_of_case(&s, 999), None);

        // La cuota se le carga a quien subió, no al dueño del proyecto.
        assert_eq!(used_bytes(&s, 20), 300);
        assert_eq!(used_bytes(&s, 10), 0);

        // Y salirse quita el acceso de verdad.
        s.conn()
            .execute("DELETE FROM project_members WHERE project_id = 1 AND user_id = 20", [])
            .unwrap();
        assert_eq!(access(&s, 20, 1), None);

        drop(s);
        std::fs::remove_dir_all(&dir).ok();
    }
}
