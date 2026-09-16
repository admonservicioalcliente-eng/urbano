import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

os.chdir(os.path.dirname(os.path.abspath(__file__)))

import scra

scra.DEFAULT_URLS = [
    "https://redpropiedadhorizontal.com/red-administradores-propiedad-horizontal/",
]
scra.HEADERS["Connection"] = "close"

print("Iniciando extracción rápida de administradores Medellín...")
all_rows = []
seen_rows = set()

for base_url in scra.DEFAULT_URLS[:3]:
    print(f"Procesando: {base_url}")
    rows = scra.fetch_site(base_url, max_pages=1)
    for row in rows:
        key = scra.row_key(row)
        if key not in seen_rows:
            seen_rows.add(key)
            all_rows.append(row)

report = scra.generate_report(all_rows, output_dir=os.path.dirname(os.path.abspath(__file__)))
if report:
    scra.print_summary(report)
else:
    print("No se encontraron resultados. Creando datos de ejemplo...")
    demo_rows = [
        {"Nombre": "Administradores de Propiedad Horizontal de Medellín", "Teléfono": "+574 444 5555", "Email": "info@aphmedellin.com", "Sitio Web": "https://aphmedellin.com", "Ciudad": "Medellín", "Fuente": "demo", "URL": "demo"},
        {"Nombre": "Gestión Inmobiliaria Medellín S.A.S.", "Teléfono": "+57310 123 4567", "Email": "contacto@gestionmedellin.com", "Sitio Web": "https://gestionmedellin.com", "Ciudad": "Medellín", "Fuente": "demo", "URL": "demo"},
        {"Nombre": "Administradores de Edificios Oriente", "Teléfono": "+57312 987 6543", "Email": "admin@oriente.com.co", "Sitio Web": "https://edificiosoriente.com", "Ciudad": "Medellín", "Fuente": "demo", "URL": "demo"},
        {"Nombre": "Servicios de Administración PH Antioquia", "Teléfono": "+574 555 1234", "Email": "info@phantioquia.com", "Sitio Web": "https://phantioquia.com", "Ciudad": "Medellín", "Fuente": "demo", "URL": "demo"},
        {"Nombre": "Administración de Conjuntos Residenciales Laureles", "Teléfono": "+57313 555 7890", "Email": "laureles@admin.com", "Sitio Web": "https://laureles-admin.com", "Ciudad": "Medellín", "Fuente": "demo", "URL": "demo"},
    ]
    report = scra.generate_report(demo_rows, output_dir=os.path.dirname(os.path.abspath(__file__)))
    if report:
        scra.print_summary(report)
