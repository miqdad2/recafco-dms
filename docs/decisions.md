# Decisions

Business decisions confirmed by RECAFCO, and the technical decisions that
follow from them. Newest first. Do not implement anything here as a rule
unless it is marked **confirmed**.

## 2026-11-10 — Unit 2

### Confirmed by RECAFCO (in the Unit 2 session)

1. **Upload into any department.** Any employee with upload permission may
   upload into any *active* department. The uploader's name and the upload
   date are shown next to every document.
   - Consequence: a user's assigned department is organizational only. It
     shows "Your department" on the home page; it limits nothing.
2. **Department controllers** may, in their permitted departments:
   upload (as every employee can), and correct a document's **title,
   category and department**, moving it only between their own
   departments. Nothing else. Controllers are **not** administrators.

### Requested by RECAFCO for Unit 2 (product brief)

- Department-based home page; department page with scoped search,
  category filter, newest-first list.
- A separate, server-protected RECAFCO administration area: departments,
  categories, users and roles, controllers, document details and ownership,
  confidential groups and membership.
- Deactivate, never delete. Dangerous infrastructure operations stay out of
  ordinary admin screens.

### Technical decisions

| Decision | Why |
|---|---|
| Departments and categories are extension records (`Department`, `Category`), linked to each document by `DocumentClassification` (foreign keys). The names are mirrored into the Mayan metadata `recafco_department` / `recafco_category`. | Renames keep history (the record is the same); Mayan's own screens and search still show the names. |
| Rename rewrites the stored Mayan metadata values one by one (events recorded, search re-indexed). | Mayan search stays correct after a rename. Slow for very large departments; acceptable for a rare admin action. |
| Names cannot contain `, ' " \ { } %`. | Mayan renders the lookup list as a template and splits it with `shlex`. |
| Administrators = members of the Django group **RECAFCO Administrators**, with **no Mayan role or permission**. Every `/recafco/admin/` view requires `IsAuthenticated` + `IsPortalAdmin`; `urls.py` refuses to load if an admin route lacks it. `recafco_setup` refuses to run if the group is attached to a Mayan role. | Admin rights live entirely in the extension and are checked per request. |
| Administrators see documents only through Mayan ACLs, like everyone else. | "Administrator" must not quietly mean "can read confidential documents". |
| Mayan superusers/staff are hidden from and protected against the RECAFCO admin area. | Those are system accounts (dangerous operations stay elsewhere). |
| A confidential access group = its own Mayan document type + role + group, with read permissions only on that type. The Unit 1 type **RECAFCO Confidential** read by **RECAFCO Controllers** is registered as the first group, "Confidential (original group)". | Per-document ACLs cannot remove inherited access (Unit 1 finding), so each confidential audience needs its own document type. |
| The Mayan group named "RECAFCO Controllers" keeps its Unit 1 name and meaning (confidential readers). The new **Department controller** role is `ControllerAssignment` rows, unrelated to that group. | Avoids renaming a live Mayan group; the portal labels the two clearly. |
| Every admin change writes an append-only `AuditEntry`. | History must survive deactivation and corrections. |
| Counts on department cards are computed from the documents the caller may view. | Confidential documents must not leak through numbers. |
| Department search runs Mayan's own search engine on a queryset already limited to the department and the caller's access. | Correct counts and pagination; same matching as company-wide search. |
