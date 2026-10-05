
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "attachments": {
                  Row: {
                    "byte_size": number | null,"capture_id": string | null,"created_at": string,"id": string,"job_id": string | null,"mime_type": string,"org_id": string,"storage_path": string,"uploaded_by": string | null
                  }
                  Insert: {
                    "byte_size"?: number | null,"capture_id"?: string | null,"created_at"?: string,"id"?: string,"job_id"?: string | null,"mime_type": string,"org_id": string,"storage_path": string,"uploaded_by"?: string | null
                  }
                  Update: {
                    "byte_size"?: number | null,"capture_id"?: string | null,"created_at"?: string,"id"?: string,"job_id"?: string | null,"mime_type"?: string,"org_id"?: string,"storage_path"?: string,"uploaded_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "attachments_capture_id_org_id_fkey"
      columns: ["capture_id","org_id"]
isOneToOne: false
      referencedRelation: "captures"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "attachments_job_id_org_id_fkey"
      columns: ["job_id","org_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "attachments_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_events": {
                  Row: {
                    "action": string,"actor_user_id": string | null,"after": Json | null,"before": Json | null,"capture_id": string | null,"change_set_id": string | null,"entity_id": string,"entity_type": string,"id": string,"occurred_at": string,"org_id": string,"source": Database["public"]['Enums']["audit_source"]
                  }
                  Insert: {
                    "action": string,"actor_user_id"?: string | null,"after"?: Json | null,"before"?: Json | null,"capture_id"?: string | null,"change_set_id"?: string | null,"entity_id": string,"entity_type": string,"id"?: string,"occurred_at"?: string,"org_id": string,"source": Database["public"]['Enums']["audit_source"]
                  }
                  Update: {
                    "action"?: string,"actor_user_id"?: string | null,"after"?: Json | null,"before"?: Json | null,"capture_id"?: string | null,"change_set_id"?: string | null,"entity_id"?: string,"entity_type"?: string,"id"?: string,"occurred_at"?: string,"org_id"?: string,"source"?: Database["public"]['Enums']["audit_source"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_events_capture_id_org_id_fkey"
      columns: ["capture_id","org_id"]
isOneToOne: false
      referencedRelation: "captures"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "audit_events_change_set_id_org_id_fkey"
      columns: ["change_set_id","org_id"]
isOneToOne: false
      referencedRelation: "change_sets"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "audit_events_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"capture_answers": {
                  Row: {
                    "answer": string,"answered_by": string | null,"capture_id": string,"change_set_id": string,"created_at": string,"id": string,"org_id": string,"question": string
                  }
                  Insert: {
                    "answer": string,"answered_by"?: string | null,"capture_id": string,"change_set_id": string,"created_at"?: string,"id"?: string,"org_id": string,"question": string
                  }
                  Update: {
                    "answer"?: string,"answered_by"?: string | null,"capture_id"?: string,"change_set_id"?: string,"created_at"?: string,"id"?: string,"org_id"?: string,"question"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "capture_answers_capture_id_org_id_fkey"
      columns: ["capture_id","org_id"]
isOneToOne: false
      referencedRelation: "captures"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "capture_answers_change_set_id_org_id_fkey"
      columns: ["change_set_id","org_id"]
isOneToOne: false
      referencedRelation: "change_sets"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"captures": {
                  Row: {
                    "created_at": string,"created_by": string,"error": string | null,"id": string,"org_id": string,"raw_text": string | null,"status": Database["public"]['Enums']["capture_status"],"target_job_id": string | null,"type": Database["public"]['Enums']["capture_type"],"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by": string,"error"?: string | null,"id"?: string,"org_id": string,"raw_text"?: string | null,"status"?: Database["public"]['Enums']["capture_status"],"target_job_id"?: string | null,"type": Database["public"]['Enums']["capture_type"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"error"?: string | null,"id"?: string,"org_id"?: string,"raw_text"?: string | null,"status"?: Database["public"]['Enums']["capture_status"],"target_job_id"?: string | null,"type"?: Database["public"]['Enums']["capture_type"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "captures_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "captures_target_job_id_org_id_fkey"
      columns: ["target_job_id","org_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"change_sets": {
                  Row: {
                    "base_job_versions": NonNullable<Json>,"capture_id": string,"created_at": string,"id": string,"operations": NonNullable<Json>,"org_id": string,"reviewed_at": string | null,"reviewed_by": string | null,"status": Database["public"]['Enums']["change_set_status"],"temp_id_map": Json | null,"validation_issues": NonNullable<Json>
                  }
                  Insert: {
                    "base_job_versions"?: NonNullable<Json>,"capture_id": string,"created_at"?: string,"id"?: string,"operations": NonNullable<Json>,"org_id": string,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"status"?: Database["public"]['Enums']["change_set_status"],"temp_id_map"?: Json | null,"validation_issues"?: NonNullable<Json>
                  }
                  Update: {
                    "base_job_versions"?: NonNullable<Json>,"capture_id"?: string,"created_at"?: string,"id"?: string,"operations"?: NonNullable<Json>,"org_id"?: string,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"status"?: Database["public"]['Enums']["change_set_status"],"temp_id_map"?: Json | null,"validation_issues"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "change_sets_capture_id_org_id_fkey"
      columns: ["capture_id","org_id"]
isOneToOne: false
      referencedRelation: "captures"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"clients": {
                  Row: {
                    "created_at": string,"created_by": string | null,"email": string | null,"id": string,"name": string,"notes": string | null,"org_id": string,"phone": string | null,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"email"?: string | null,"id"?: string,"name": string,"notes"?: string | null,"org_id": string,"phone"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"email"?: string | null,"id"?: string,"name"?: string,"notes"?: string | null,"org_id"?: string,"phone"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "clients_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"equipment": {
                  Row: {
                    "created_at": string,"id": string,"installed_on": string | null,"kind": string,"manufacturer": string | null,"model": string | null,"notes": string | null,"org_id": string,"serial_number": string | null,"site_id": string,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"id"?: string,"installed_on"?: string | null,"kind": string,"manufacturer"?: string | null,"model"?: string | null,"notes"?: string | null,"org_id": string,"serial_number"?: string | null,"site_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"installed_on"?: string | null,"kind"?: string,"manufacturer"?: string | null,"model"?: string | null,"notes"?: string | null,"org_id"?: string,"serial_number"?: string | null,"site_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "equipment_site_id_org_id_fkey"
      columns: ["site_id","org_id"]
isOneToOne: false
      referencedRelation: "sites"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"expenses": {
                  Row: {
                    "capture_id": string | null,"category": Database["public"]['Enums']["expense_category"],"created_at": string,"created_by": string | null,"description": string | null,"id": string,"job_id": string | null,"org_id": string,"receipt_attachment_id": string | null,"spent_on": string,"supply_house_id": string | null,"total_cents": number,"updated_at": string,"vendor_name": string | null
                  }
                  Insert: {
                    "capture_id"?: string | null,"category": Database["public"]['Enums']["expense_category"],"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"job_id"?: string | null,"org_id": string,"receipt_attachment_id"?: string | null,"spent_on"?: string,"supply_house_id"?: string | null,"total_cents": number,"updated_at"?: string,"vendor_name"?: string | null
                  }
                  Update: {
                    "capture_id"?: string | null,"category"?: Database["public"]['Enums']["expense_category"],"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"job_id"?: string | null,"org_id"?: string,"receipt_attachment_id"?: string | null,"spent_on"?: string,"supply_house_id"?: string | null,"total_cents"?: number,"updated_at"?: string,"vendor_name"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "expenses_capture_id_org_id_fkey"
      columns: ["capture_id","org_id"]
isOneToOne: false
      referencedRelation: "captures"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "expenses_job_id_org_id_fkey"
      columns: ["job_id","org_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "expenses_receipt_attachment_id_org_id_fkey"
      columns: ["receipt_attachment_id","org_id"]
isOneToOne: false
      referencedRelation: "attachments"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "expenses_supply_house_id_org_id_fkey"
      columns: ["supply_house_id","org_id"]
isOneToOne: false
      referencedRelation: "supply_houses"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"glossary_terms": {
                  Row: {
                    "created_at": string,"expansion": string,"id": string,"notes": string | null,"org_id": string,"term": string,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"expansion": string,"id"?: string,"notes"?: string | null,"org_id": string,"term": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"expansion"?: string,"id"?: string,"notes"?: string | null,"org_id"?: string,"term"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "glossary_terms_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"invoice_line_items": {
                  Row: {
                    "created_at": string,"description": string,"id": string,"invoice_id": string,"kind": Database["public"]['Enums']["quote_line_kind"],"org_id": string,"position": number,"quantity": number,"unit": string | null,"unit_price_cents": number
                  }
                  Insert: {
                    "created_at"?: string,"description": string,"id"?: string,"invoice_id": string,"kind": Database["public"]['Enums']["quote_line_kind"],"org_id": string,"position": number,"quantity": number,"unit"?: string | null,"unit_price_cents": number
                  }
                  Update: {
                    "created_at"?: string,"description"?: string,"id"?: string,"invoice_id"?: string,"kind"?: Database["public"]['Enums']["quote_line_kind"],"org_id"?: string,"position"?: number,"quantity"?: number,"unit"?: string | null,"unit_price_cents"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoice_line_items_invoice_id_org_id_fkey"
      columns: ["invoice_id","org_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"invoices": {
                  Row: {
                    "created_at": string,"created_by": string | null,"due_on": string | null,"id": string,"issued_on": string,"job_id": string,"notes": string | null,"number": number,"org_id": string,"status": Database["public"]['Enums']["invoice_status"],"total_cents": number,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"due_on"?: string | null,"id"?: string,"issued_on"?: string,"job_id": string,"notes"?: string | null,"number": number,"org_id": string,"status"?: Database["public"]['Enums']["invoice_status"],"total_cents": number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"due_on"?: string | null,"id"?: string,"issued_on"?: string,"job_id"?: string,"notes"?: string | null,"number"?: number,"org_id"?: string,"status"?: Database["public"]['Enums']["invoice_status"],"total_cents"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoices_job_id_org_id_fkey"
      columns: ["job_id","org_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"job_status_transitions": {
                  Row: {
                    "from_status": Database["public"]['Enums']["job_status"],"to_status": Database["public"]['Enums']["job_status"]
                  }
                  Insert: {
                    "from_status": Database["public"]['Enums']["job_status"],"to_status": Database["public"]['Enums']["job_status"]
                  }
                  Update: {
                    "from_status"?: Database["public"]['Enums']["job_status"],"to_status"?: Database["public"]['Enums']["job_status"]
                  }
                  Relationships: [
                    
                  ]
                },"jobs": {
                  Row: {
                    "client_id": string,"created_at": string,"created_by": string | null,"description": string | null,"id": string,"job_type": string | null,"org_id": string,"scheduled_end": string | null,"scheduled_start": string | null,"site_id": string | null,"status": Database["public"]['Enums']["job_status"],"title": string,"updated_at": string,"version": number
                  }
                  Insert: {
                    "client_id": string,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"job_type"?: string | null,"org_id": string,"scheduled_end"?: string | null,"scheduled_start"?: string | null,"site_id"?: string | null,"status"?: Database["public"]['Enums']["job_status"],"title": string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "client_id"?: string,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"job_type"?: string | null,"org_id"?: string,"scheduled_end"?: string | null,"scheduled_start"?: string | null,"site_id"?: string | null,"status"?: Database["public"]['Enums']["job_status"],"title"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "jobs_client_id_org_id_fkey"
      columns: ["client_id","org_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "jobs_site_id_client_id_fkey"
      columns: ["site_id","client_id"]
isOneToOne: false
      referencedRelation: "sites"
      referencedColumns: ["id","client_id"]
    },{
      foreignKeyName: "jobs_site_id_org_id_fkey"
      columns: ["site_id","org_id"]
isOneToOne: false
      referencedRelation: "sites"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"material_items": {
                  Row: {
                    "created_at": string,"description": string,"expense_id": string | null,"id": string,"job_id": string,"org_id": string,"quantity": number,"removed_at": string | null,"removed_reason": string | null,"status": Database["public"]['Enums']["material_status"],"supply_house_id": string | null,"unit": string | null,"unit_cost_cents": number | null,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"description": string,"expense_id"?: string | null,"id"?: string,"job_id": string,"org_id": string,"quantity": number,"removed_at"?: string | null,"removed_reason"?: string | null,"status"?: Database["public"]['Enums']["material_status"],"supply_house_id"?: string | null,"unit"?: string | null,"unit_cost_cents"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string,"expense_id"?: string | null,"id"?: string,"job_id"?: string,"org_id"?: string,"quantity"?: number,"removed_at"?: string | null,"removed_reason"?: string | null,"status"?: Database["public"]['Enums']["material_status"],"supply_house_id"?: string | null,"unit"?: string | null,"unit_cost_cents"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "material_items_expense_fkey"
      columns: ["expense_id","org_id"]
isOneToOne: false
      referencedRelation: "expenses"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "material_items_job_id_org_id_fkey"
      columns: ["job_id","org_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "material_items_supply_house_id_org_id_fkey"
      columns: ["supply_house_id","org_id"]
isOneToOne: false
      referencedRelation: "supply_houses"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"notes": {
                  Row: {
                    "author_id": string | null,"body": string,"client_id": string | null,"created_at": string,"id": string,"job_id": string | null,"org_id": string,"updated_at": string
                  }
                  Insert: {
                    "author_id"?: string | null,"body": string,"client_id"?: string | null,"created_at"?: string,"id"?: string,"job_id"?: string | null,"org_id": string,"updated_at"?: string
                  }
                  Update: {
                    "author_id"?: string | null,"body"?: string,"client_id"?: string | null,"created_at"?: string,"id"?: string,"job_id"?: string | null,"org_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notes_client_id_org_id_fkey"
      columns: ["client_id","org_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "notes_job_id_org_id_fkey"
      columns: ["job_id","org_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"order_lines": {
                  Row: {
                    "created_at": string,"description": string,"id": string,"material_item_id": string | null,"org_id": string,"position": number,"quantity": number,"sku": string | null,"supply_order_id": string,"unit": string | null
                  }
                  Insert: {
                    "created_at"?: string,"description": string,"id"?: string,"material_item_id"?: string | null,"org_id": string,"position": number,"quantity": number,"sku"?: string | null,"supply_order_id": string,"unit"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"description"?: string,"id"?: string,"material_item_id"?: string | null,"org_id"?: string,"position"?: number,"quantity"?: number,"sku"?: string | null,"supply_order_id"?: string,"unit"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_lines_material_item_id_org_id_fkey"
      columns: ["material_item_id","org_id"]
isOneToOne: false
      referencedRelation: "material_items"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "order_lines_supply_order_id_org_id_fkey"
      columns: ["supply_order_id","org_id"]
isOneToOne: false
      referencedRelation: "supply_orders"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"org_members": {
                  Row: {
                    "created_at": string,"org_id": string,"role": Database["public"]['Enums']["org_role"],"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"org_id": string,"role"?: Database["public"]['Enums']["org_role"],"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"org_id"?: string,"role"?: Database["public"]['Enums']["org_role"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "org_members_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"payments": {
                  Row: {
                    "amount_cents": number,"created_at": string,"created_by": string | null,"id": string,"invoice_id": string,"method": Database["public"]['Enums']["payment_method"] | null,"notes": string | null,"org_id": string,"paid_on": string,"reference": string | null
                  }
                  Insert: {
                    "amount_cents": number,"created_at"?: string,"created_by"?: string | null,"id"?: string,"invoice_id": string,"method"?: Database["public"]['Enums']["payment_method"] | null,"notes"?: string | null,"org_id": string,"paid_on"?: string,"reference"?: string | null
                  }
                  Update: {
                    "amount_cents"?: number,"created_at"?: string,"created_by"?: string | null,"id"?: string,"invoice_id"?: string,"method"?: Database["public"]['Enums']["payment_method"] | null,"notes"?: string | null,"org_id"?: string,"paid_on"?: string,"reference"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_invoice_id_org_id_fkey"
      columns: ["invoice_id","org_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"full_name": string | null,"id": string,"phone": string | null,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"full_name"?: string | null,"id": string,"phone"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"full_name"?: string | null,"id"?: string,"phone"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"quote_line_items": {
                  Row: {
                    "created_at": string,"description": string,"id": string,"kind": Database["public"]['Enums']["quote_line_kind"],"material_item_id": string | null,"org_id": string,"position": number,"quantity": number,"quote_id": string,"unit": string | null,"unit_price_cents": number
                  }
                  Insert: {
                    "created_at"?: string,"description": string,"id"?: string,"kind": Database["public"]['Enums']["quote_line_kind"],"material_item_id"?: string | null,"org_id": string,"position": number,"quantity": number,"quote_id": string,"unit"?: string | null,"unit_price_cents": number
                  }
                  Update: {
                    "created_at"?: string,"description"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["quote_line_kind"],"material_item_id"?: string | null,"org_id"?: string,"position"?: number,"quantity"?: number,"quote_id"?: string,"unit"?: string | null,"unit_price_cents"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "quote_line_items_material_item_id_org_id_fkey"
      columns: ["material_item_id","org_id"]
isOneToOne: false
      referencedRelation: "material_items"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "quote_line_items_quote_id_org_id_fkey"
      columns: ["quote_id","org_id"]
isOneToOne: false
      referencedRelation: "quotes"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"quotes": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"job_id": string,"notes": string | null,"org_id": string,"status": Database["public"]['Enums']["quote_status"],"supersedes_quote_id": string | null,"total_cents": number,"updated_at": string,"valid_until": string | null,"version": number
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"job_id": string,"notes"?: string | null,"org_id": string,"status"?: Database["public"]['Enums']["quote_status"],"supersedes_quote_id"?: string | null,"total_cents"?: number,"updated_at"?: string,"valid_until"?: string | null,"version": number
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"job_id"?: string,"notes"?: string | null,"org_id"?: string,"status"?: Database["public"]['Enums']["quote_status"],"supersedes_quote_id"?: string | null,"total_cents"?: number,"updated_at"?: string,"valid_until"?: string | null,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "quotes_job_id_org_id_fkey"
      columns: ["job_id","org_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "quotes_supersedes_quote_id_org_id_fkey"
      columns: ["supersedes_quote_id","org_id"]
isOneToOne: false
      referencedRelation: "quotes"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"sites": {
                  Row: {
                    "access_notes": string | null,"city": string | null,"client_id": string,"created_at": string,"id": string,"label": string | null,"line1": string,"line2": string | null,"org_id": string,"postal_code": string | null,"region": string | null,"updated_at": string
                  }
                  Insert: {
                    "access_notes"?: string | null,"city"?: string | null,"client_id": string,"created_at"?: string,"id"?: string,"label"?: string | null,"line1": string,"line2"?: string | null,"org_id": string,"postal_code"?: string | null,"region"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "access_notes"?: string | null,"city"?: string | null,"client_id"?: string,"created_at"?: string,"id"?: string,"label"?: string | null,"line1"?: string,"line2"?: string | null,"org_id"?: string,"postal_code"?: string | null,"region"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sites_client_id_org_id_fkey"
      columns: ["client_id","org_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"supply_houses": {
                  Row: {
                    "account_number": string | null,"api_config": NonNullable<Json>,"created_at": string,"email": string | null,"id": string,"integration_type": Database["public"]['Enums']["supply_integration_type"],"name": string,"notes": string | null,"org_id": string,"phone": string | null,"updated_at": string
                  }
                  Insert: {
                    "account_number"?: string | null,"api_config"?: NonNullable<Json>,"created_at"?: string,"email"?: string | null,"id"?: string,"integration_type"?: Database["public"]['Enums']["supply_integration_type"],"name": string,"notes"?: string | null,"org_id": string,"phone"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "account_number"?: string | null,"api_config"?: NonNullable<Json>,"created_at"?: string,"email"?: string | null,"id"?: string,"integration_type"?: Database["public"]['Enums']["supply_integration_type"],"name"?: string,"notes"?: string | null,"org_id"?: string,"phone"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "supply_houses_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"supply_orders": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"job_id": string | null,"notes": string | null,"org_id": string,"sent_at": string | null,"sent_by": string | null,"status": Database["public"]['Enums']["supply_order_status"],"supply_house_id": string,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"job_id"?: string | null,"notes"?: string | null,"org_id": string,"sent_at"?: string | null,"sent_by"?: string | null,"status"?: Database["public"]['Enums']["supply_order_status"],"supply_house_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"job_id"?: string | null,"notes"?: string | null,"org_id"?: string,"sent_at"?: string | null,"sent_by"?: string | null,"status"?: Database["public"]['Enums']["supply_order_status"],"supply_house_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "supply_orders_job_id_org_id_fkey"
      columns: ["job_id","org_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "supply_orders_supply_house_id_org_id_fkey"
      columns: ["supply_house_id","org_id"]
isOneToOne: false
      referencedRelation: "supply_houses"
      referencedColumns: ["id","org_id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "create_organization":
{ Args: { "p_name": string }; Returns: string
                           },
"dashboard_summary":
{ Args: { "p_org_id": string,"p_year"?: number }; Returns: Json
                           },
"has_org_role":
{ Args: { "p_org_id": string,"p_roles": (Database["public"]['Enums']["org_role"])[] }; Returns: boolean
                           },
"is_org_member":
{ Args: { "p_org_id": string }; Returns: boolean
                           },
"storage_path_org_member":
{ Args: { "object_name": string }; Returns: boolean
                           }
          }
          Enums: {
            "audit_source": "manual"|"voice"|"image"|"text"|"system","capture_status": "uploaded"|"processing"|"ready_for_review"|"committed"|"rejected"|"failed","capture_type": "audio"|"image"|"text","change_set_status": "pending"|"approved"|"rejected","expense_category": "materials"|"subcontractors"|"tools_equipment"|"equipment_rental"|"vehicle"|"supplies"|"permits_licenses"|"insurance"|"phone_software"|"advertising"|"office"|"meals"|"disposal"|"training"|"bank_fees"|"other","invoice_status": "draft"|"sent"|"paid"|"void","job_status": "lead"|"quoted"|"accepted"|"scheduled"|"in_progress"|"completed"|"invoiced"|"paid"|"declined"|"cancelled","material_status": "needed"|"ordered"|"purchased"|"installed"|"returned","org_role": "owner"|"admin"|"member","payment_method": "cash"|"check"|"card"|"transfer"|"other","quote_line_kind": "labor"|"material","quote_status": "draft"|"sent"|"accepted"|"rejected"|"superseded","supply_integration_type": "email"|"api"|"manual","supply_order_status": "draft"|"sent"|"confirmed"|"received"|"cancelled"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "audit_source": ["manual", "voice", "image", "text", "system"],"capture_status": ["uploaded", "processing", "ready_for_review", "committed", "rejected", "failed"],"capture_type": ["audio", "image", "text"],"change_set_status": ["pending", "approved", "rejected"],"expense_category": ["materials", "subcontractors", "tools_equipment", "equipment_rental", "vehicle", "supplies", "permits_licenses", "insurance", "phone_software", "advertising", "office", "meals", "disposal", "training", "bank_fees", "other"],"invoice_status": ["draft", "sent", "paid", "void"],"job_status": ["lead", "quoted", "accepted", "scheduled", "in_progress", "completed", "invoiced", "paid", "declined", "cancelled"],"material_status": ["needed", "ordered", "purchased", "installed", "returned"],"org_role": ["owner", "admin", "member"],"payment_method": ["cash", "check", "card", "transfer", "other"],"quote_line_kind": ["labor", "material"],"quote_status": ["draft", "sent", "accepted", "rejected", "superseded"],"supply_integration_type": ["email", "api", "manual"],"supply_order_status": ["draft", "sent", "confirmed", "received", "cancelled"]
          }
        }
} as const
