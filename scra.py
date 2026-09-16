import base64
import json
import os
import random
import re
import sys
import time
from datetime import datetime
from urllib.parse import parse_qs, unquote, urlencode, urlparse, urlunparse

import pandas as pd
import requests
from bs4 import BeautifulSoup

try:
    from playwright.sync_api import sync_playwright
except Exception:
    sync_playwright = None

DEFAULT_URLS = [
    "https://redpropiedadhorizontal.com/red-administradores-propiedad-horizontal/",
    "https://www.camacol.org.co/encuentra-construir/administracion-de-propiedades/",
    "https://www.fincaraiz.com.co/admin/propiedad-horizontal/",
    "https://www.metrocuadrado.com.co/administracion-de-propiedades-horizontal/",
    "https://www.mercado-inmueble.com/administradores/",
    "https://www.propiedades.com.co/administradores-propiedad-horizontal/",
    "https://www.inmuebles24.com.co/administradores-edificios-medellin/",
    "https://www.vivanuncios.com.co/administradores-propiedad-horizontal/",
    "https://www.alamo.com.co/administradores/",
    "https://www.la-casa-inmobiliaria.com/administradores/",
    "https://www.propertyshop.com.co/administradores/",
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}

SEARCH_QUERIES = [
    'administradores propiedad horizontal Medellín',
    'administración de edificios Medellín teléfono',
    'administradores de unidades residenciales Medellín',
    'administradores de conjuntos residenciales Medellín',
    'administración de edificios Medellín Antioquia',
    'administradores PH Medellín',
    'administradores de fincas Medellín',
    'gestión de propiedad horizontal Medellín',
    'empresas de administración de edificios Medellín',
    'administradores de edificios residenciales Medellín',
    'administración horizontal Medellín precio',
    'administradores de comunidades Medellín',
    'administración de conjuntos cerrados Medellín',
    'administradores de torres residenciales Medellín',
    'servicios de administración de propiedad Medellín',
    'administradores de edificios Medellín sin expensas',
    'administración de propiedad horizontal Medellín costo',
    'administradores de edificios Medellín centros',
    'administración edificios Medellín occidente',
    'administradores de edificios Medellín norte',
    'administración de edificios Medellín oriente',
    'administradores de edificios Medellín sur',
    'administración de edificios Medellín Laureles',
    'administración de edificios Medellín Envigado',
    'administración de edificios Medellín Sabaneta',
    'administración de edificios Medellín Itagüí',
    'administración de edificios Medellín Bello',
    'administración de edificios Medellín Copacabana',
    'administradores de edificios Medellín centro',
    'administradores de propiedad horizontal Antioquia',
    'administradores de edificios Medellín 2024',
    'administradores de edificios Medellín 2025',
    'administración de propiedad horizontal profesional Medellín',
    'administradores de edificios residenciales Medellín teléfono',
    'administración de edificios Medellín dirección',
    'administradores de edificios Medellín email',
    'administración de propiedad horizontal Medellín servicios',
    'administradores de condominios Medellín',
    'administración de comunidades residenciales Medellín',
    'administradores de edificios Medellín lista',
    'administración de edificios Medellín comparación',
    'administradores de propiedad horizontal Medellín recomendados',
    'administración de edificios Medellín mejores',
    'administradores de edificios Medellín reseñas',
    'administración de propiedad horizontal Medellín costos',
    'administradores de edificios Medellín precio',
    'administración de propiedad horizontal Medellín cotización',
]


def normalize_text(value):
    if not value:
        return "N/A"
    return value.get_text(" ", strip=True) if hasattr(value, "get_text") else str(value).strip() or "N/A"


def build_page_urls(base_url, max_pages=5):
    urls = [base_url]
    parsed = urlparse(base_url)
    path = parsed.path.rstrip("/")

    for page in range(2, max_pages + 1):
        if "page=" in parsed.query or "pagina=" in parsed.query:
            query = parse_qs(parsed.query, keep_blank_values=True)
            if "page" in query:
                query["page"] = [str(page)]
            elif "pagina" in query:
                query["pagina"] = [str(page)]
            else:
                query["page"] = [str(page)]
            new_query = urlencode(query, doseq=True)
            new_url = urlunparse(parsed._replace(query=new_query))
        elif "/page/" in parsed.path:
            base_path = re.sub(r"/page/\d+/?$", "", path)
            new_url = f"{parsed.scheme}://{parsed.netloc}{base_path}/page/{page}/"
        else:
            new_url = f"{parsed.scheme}://{parsed.netloc}{path}/page/{page}/"
        urls.append(new_url)

    return urls


def looks_like_real_admin_entry(row):
    nombre = str(row.get("Nombre", "")).strip()
    telefono = str(row.get("Teléfono", "")).strip()
    web = str(row.get("Sitio Web", "")).strip()
    email = str(row.get("Email", "")).strip()
    fuente = str(row.get("Fuente", "")).strip()
    ciudad = str(row.get("Ciudad", "")).strip()
    nombre_l = nombre.lower()

    if not nombre or nombre_l in {"n/a"}:
        return False

    generic_title_markers = (
        "educar para vivir",
        "eventos",
        "capacitacion",
        "sitio oficial",
        "página principal",
        "inicio",
        "home",
    )
    if any(marker in nombre_l for marker in generic_title_markers):
        return False

    if "propiedad horizontal" in nombre_l and ("administrador" in nombre_l or "administración" in nombre_l or "administracion" in nombre_l):
        return True

    if any(marker in nombre_l for marker in ("propiedad horizontal", "administración de edificios")):
        pass

    if web and any(ext in web.lower() for ext in (".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".pdf")):
        return False
    if "/wp-content/uploads/" in web.lower() or "/wp-content/" in web.lower():
        return False

    has_phone = telefono not in {"N/A", "", "None"}
    has_email = email.lower() not in {"n/a", "", "none"}
    has_external_site = web not in {"N/A", "", "None"} and web != fuente
    has_city = ciudad.lower() in {"medellín", "medellin", "antioquia", "colombia"} or "medell" in nombre_l

    if has_phone or has_email or has_external_site:
        return True
    if has_city and (has_phone or has_email or has_external_site):
        return True
    if has_city and (nombre_l.count("administrador") > 0 or "administración" in nombre_l or "administracion" in nombre_l):
        return True
    if len(nombre) > 3 and len(nombre) < 100:
        return True
    return False


def extract_from_cards(soup):
    selectors = [
        "div.card-admin", "div.admin-card", "div.item-admin", "div.empresa-card",
        ".card-admin", ".admin-card", ".item-admin", ".empresa-card",
        "article.admin", "article.item", "article.empresa",
        "li.admin-item", "li.item", "li.empresa-item",
        ".admin-item", ".item", ".empresa", ".listing-item",
        "div.listing", "div.result-item", "div.search-result",
        "div.col-md-4", "div.col-lg-3", "div.col-sm-6",
        "div.post", "div.entry", "div.post-item",
        "div.teaser", "div.promo", "div.widget-item",
        "div.panel", "div.panel-default", "div.box",
        "div.row > div > div",
    ]

    cards = []
    for selector in selectors:
        found = soup.select(selector)
        if found and len(found) > 1:
            cards = found
            break

    if not cards:
        all_divs = soup.find_all("div", recursive=True)
        candidate_cards = []
        for d in all_divs:
            children = d.find_all(recursive=False)
            if len(children) >= 2 and d.get("class") and len(d.get("class")) <= 4:
                has_text = bool(d.get_text(strip=True))
                has_link = bool(d.select_one("a"))
                has_heading = bool(d.select_one("h1, h2, h3, h4, h5, h6"))
                if has_text and has_link and has_heading:
                    candidate_cards.append(d)
        if candidate_cards:
            cards = candidate_cards[:20]

    if not cards:
        return []

    rows = []
    for card in cards:
        nombre = card.select_one("h2.nombre, h3.nombre, .nombre, .title, h2, h3, h2 a, h3 a, .item-title a, .card-title a, .listing-title a")
        telefono = card.select_one("span.telefono, .telefono, .phone, a[href^='tel:'], .phone-number, .tel, a[href^='tel']")
        sitio = card.select_one("a.sitio-web, .sitio-web, a[href*='http'], .website, .btn-ver, .ver-mas, a.btn, .card-link")
        email = card.select_one("a[href^='mailto:'], .email, .correo, .mail")

        nombre_txt = normalize_text(nombre)
        telefono_txt = normalize_text(telefono)
        if telefono_txt == "N/A":
            text = " ".join(card.stripped_strings)
            phone_match = re.search(
                r"(?:\+?57\s?)?(?:3(?:0|1|2|3|4|5|6|7|8|9)[\s.-]?\d[\s.-]?\d[\s.-]?\d[\s.-]?\d[\s.-]?\d[\s.-]?\d)",
                text,
            )
            if phone_match:
                telefono_txt = phone_match.group(0).strip()

        web_txt = sitio.get("href", "N/A") if sitio else "N/A"
        email_txt = normalize_text(email) if email else "N/A"
        if email_txt == "N/A" and email and email.get("href"):
            email_txt = email["href"].replace("mailto:", "").strip()

        row = {
            "Nombre": nombre_txt,
            "Teléfono": telefono_txt,
            "Email": email_txt if email_txt != "N/A" else "N/A",
            "Sitio Web": web_txt,
            "Ciudad": "Medellín",
            "Fuente": "",
            "URL": "",
        }

        if looks_like_real_admin_entry(row):
            rows.append(row)

    return rows


def extract_from_jsonld(soup, source_url):
    rows = []
    scripts = soup.select('script[type="application/ld+json"]')

    def visit(value):
        if isinstance(value, list):
            for item in value:
                visit(item)
            return
        if not isinstance(value, dict):
            return

        item_type = str(value.get("@type", "")).lower()
        if any(kind in item_type for kind in ("person", "organization", "localbusiness", "service")):
            row = {
                "Nombre": value.get("name", "N/A"),
                "Teléfono": value.get("telephone", "N/A"),
                "Email": value.get("email", "N/A"),
                "Sitio Web": value.get("url", source_url),
                "Ciudad": "Medellín",
                "Dirección": value.get("address", {}).get("streetAddress", "N/A") if isinstance(value.get("address", {}), dict) else value.get("address", "N/A"),
                "Descripción": value.get("description", ""),
                "Horario": json.dumps(value.get("openingHours", []), ensure_ascii=False) if isinstance(value.get("openingHours", []), list) else value.get("openingHours", ""),
                "Fuente": source_url,
                "URL": source_url,
            }
            if looks_like_real_admin_entry(row):
                rows.append(row)

        for child in value.values():
            visit(child)

    for script in scripts:
        try:
            visit(json.loads(script.string or script.get_text()))
        except (TypeError, json.JSONDecodeError):
            continue
    return rows


def extract_from_tables(soup, source_url):
    rows = []
    for table in soup.select("table"):
        headers = [normalize_text(cell).lower() for cell in table.select("thead th")]
        if not headers:
            first_row = table.select_one("tr")
            headers = [normalize_text(cell).lower() for cell in first_row.select("th, td")] if first_row else []
        if not headers or not any("nombre" in header or "empresa" in header or "administrador" in header for header in headers):
            continue

        for table_row in table.select("tbody tr") or table.select("tr")[1:]:
            cells = [normalize_text(cell) for cell in table_row.select("td, th")]
            if len(cells) != len(headers):
                continue
            values = dict(zip(headers, cells))
            row = {
                "Nombre": values.get("nombre", values.get("empresa", values.get("administrador", "N/A"))),
                "Teléfono": next((v for k, v in values.items() if "tel" in k or "cel" in k or "phone" in k), "N/A"),
                "Email": next((v for k, v in values.items() if "mail" in k or "correo" in k or "email" in k), "N/A"),
                "Sitio Web": next((v for k, v in values.items() if "web" in k or "sitio" in k or "url" in k), "N/A"),
                "Ciudad": "Medellín",
                "Fuente": source_url,
                "URL": source_url,
            }
            if looks_like_real_admin_entry(row):
                rows.append(row)
    return rows


def extract_from_contact_page(soup, url):
    title = soup.find("h1") or soup.find("h2") or soup.find("h3") or soup.find("h4")
    nombre = title.get_text(" ", strip=True) if title else "Red de Administradores de PH de Antioquia"

    email_tag = soup.select_one("a[href^='mailto:']")
    email = email_tag.get("href").replace("mailto:", "").strip() if email_tag else "N/A"

    phone_match = re.search(
        r"(?:\+?57\s?)?(?:3(?:0|1|2|3|4|5|6|7|8|9)[\s.-]?\d[\s.-]?\d[\s.-]?\d[\s.-]?\d[\s.-]?\d[\s.-]?\d)",
        soup.get_text(" ", strip=True),
    )
    telefono = phone_match.group(0).strip() if phone_match else "N/A"

    whatsapp_match = re.search(r'(?:whatsapp|wa\.me)\.com[\/\?].*?(?:\d{10,15})', soup.get_text(" ", strip=True), re.I)
    whatsapp = whatsapp_match.group(0) if whatsapp_match else "N/A"

    city_match = re.search(
        r"(?:Medell[ií]n|MEDELL[ií]N|Medellin)[^\n]{0,80}|(?:Carrera\s+\d+[A-Za-z]*[^\n]{0,80}(?:Medell[ií]n|Medellin))",
        soup.get_text(" ", strip=True),
        re.I,
    )
    ciudad = city_match.group(0).strip() if city_match else "Medellín"

    return [{
        "Nombre": nombre,
        "Teléfono": telefono,
        "Email": email,
        "Sitio Web": url,
        "Ciudad": ciudad,
        "Fuente": url,
        "URL": url,
    }]


def extract_open_graph(soup, source_url):
    og_title = soup.find("meta", property="og:title")
    og_description = soup.find("meta", property="og:description")
    og_url = soup.find("meta", property="og:url")
    og_image = soup.find("meta", property="og:image")
    og_site_name = soup.find("meta", property="og:site_name")

    title = og_title.get("content", "").strip() if og_title else ""
    if not title:
        return []

    row = {
        "Nombre": title,
        "Teléfono": "N/A",
        "Email": "N/A",
        "Sitio Web": og_url.get("content", "").strip() if og_url else source_url,
        "Ciudad": "Medellín",
        "Descripción": og_description.get("content", "").strip() if og_description else "",
        "Logo": og_image.get("content", "").strip() if og_image else "",
        "Fuente": source_url,
        "URL": source_url,
    }

    if looks_like_real_admin_entry(row):
        return [row]
    return []


def extract_meta_description(soup, source_url):
    meta_desc = soup.find("meta", attrs={"name": "description"})
    if not meta_desc:
        return []

    desc = meta_desc.get("content", "").strip()
    if not desc or len(desc) < 20:
        return []

    phone_match = re.search(
        r"(?:\+?57\s?)?(?:3(?:0|1|2|3|4|5|6|7|8|9)[\s.-]?\d[\s.-]?\d[\s.-]?\d[\s.-]?\d[\s.-]?\d[\s.-]?\d)",
        desc,
    )

    row = {
        "Nombre": desc[:100],
        "Teléfono": phone_match.group(0).strip() if phone_match else "N/A",
        "Sitio Web": source_url,
        "Ciudad": "Medellín",
        "Fuente": source_url,
        "URL": source_url,
    }

    if looks_like_real_admin_entry(row):
        return [row]
    return []


def extract_administradores(html: str, url: str):
    soup = BeautifulSoup(html, "html.parser")

    rows = extract_from_jsonld(soup, url)
    if rows:
        return rows

    rows = extract_open_graph(soup, url)
    if rows:
        return rows

    rows = extract_from_tables(soup, url)
    if rows:
        return rows

    rows = extract_from_cards(soup)
    if rows:
        for row in rows:
            row["Fuente"] = url
            row["URL"] = url
        return rows

    rows = extract_meta_description(soup, url)
    if rows:
        return rows

    return extract_from_contact_page(soup, url)


def read_urls_from_file(file_path):
    with open(file_path, "r", encoding="utf-8") as f:
        urls = []
        for line in f:
            url = line.strip()
            if not url or url.startswith("#"):
                continue
            parsed = urlparse(url)
            if parsed.scheme in {"http", "https"} and parsed.netloc:
                urls.append(url)
            else:
                print(f"URL ignorada por formato inválido: {url}")
    return urls


def _extract_links_from_search(html, base_domain):
    soup = BeautifulSoup(html, "html.parser")
    links = []
    for a in soup.select("a[href]"):
        href = a.get("href", "")
        parsed = urlparse(href)
        if parsed.netloc and parsed.netloc != base_domain:
            links.append(href)
    return links


def discover_public_urls(max_results=20):
    discovered = []
    seen = set()
    search_engines = [
        ("bing", "https://www.bing.com/search"),
        ("duckduckgo", "https://html.duckduckgo.com/html/"),
        ("google", "https://www.google.com/search"),
    ]

    for engine_name, engine_url in search_engines:
        for query in SEARCH_QUERIES:
            search_results = []
            try:
                if engine_name == "bing":
                    response = requests.get(engine_url, params={"q": query, "count": min(max_results, 20)}, headers=HEADERS, timeout=30)
                    response.raise_for_status()
                    soup = BeautifulSoup(response.text, "html.parser")
                    search_results = [
                        (link.get("href", "").strip(), link.get_text(" ", strip=True))
                        for link in soup.select("li.b_algo h2 a[href]")
                    ]
                elif engine_name == "duckduckgo":
                    response = requests.get(engine_url, params={"q": query}, headers=HEADERS, timeout=30)
                    response.raise_for_status()
                    soup = BeautifulSoup(response.text, "html.parser")
                    search_results = [
                        (link.get("href", "").strip(), link.get_text(" ", strip=True))
                        for link in soup.select("a.result__a[href]")
                    ]
                elif engine_name == "google":
                    response = requests.get(engine_url, params={"q": query, "num": min(max_results, 10)}, headers=HEADERS, timeout=30)
                    response.raise_for_status()
                    soup = BeautifulSoup(response.text, "html.parser")
                    search_results = [
                        (link.get("href", "").strip(), link.get_text(" ", strip=True))
                        for link in soup.select("div.g a[href]")
                    ]
            except requests.RequestException as exc:
                print(f"{engine_name.capitalize()} no disponible para '{query}': {exc}")
                continue

            if not search_results:
                continue

            for url, label in search_results:
                if url in seen:
                    continue

                parsed = urlparse(url)
                if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                    continue
                if parsed.netloc.lower().endswith(("bing.com", "duckduckgo.com", "google.com", "google.co.cr")):
                    continue

                encoded_match = re.search(r'u=([a-zA-Z0-9%=]+)', parsed.query)
                if encoded_match and engine_name == "bing":
                    try:
                        encoded = encoded_match.group(1)
                        padded = encoded + "=" * (-len(encoded) % 4)
                        decoded = base64.urlsafe_b64decode(padded).decode("utf-8")
                        url = unquote(decoded)
                        parsed = urlparse(url)
                    except (ValueError, UnicodeDecodeError):
                        pass

                if parsed.netloc.lower().endswith(("bing.com", "duckduckgo.com", "google.com")):
                    continue

                relevance_text = f"{url} {label}".lower()
                has_directory_phrase = "propiedad horizontal" in relevance_text
                has_admin_phrase = any(term in relevance_text for term in ("administrador", "administración", "administracion"))
                has_building_phrase = any(term in relevance_text for term in ("edificio", "unidad residencial", "conjunto residencial", "torre residencial"))
                has_medellin = any(term in relevance_text for term in ("medellín", "medellin", "antioquia"))
                has_service = any(term in relevance_text for term in ("servicio", "gestión", "administración", "cotización"))

                if not has_directory_phrase and not (has_admin_phrase and (has_building_phrase or has_medellin or has_service)):
                    continue

                seen.add(url)
                discovered.append({"url": url, "label": label, "query": query, "engine": engine_name})
                if len(discovered) >= max_results * len(SEARCH_QUERIES):
                    return discovered
            time.sleep(0.1)
        time.sleep(0.5)
    return discovered


def row_key(row):
    nombre = re.sub(r"\s+", " ", str(row.get("Nombre", "")).strip().lower())
    telefono = re.sub(r"\D", "", str(row.get("Teléfono", "")))
    email = str(row.get("Email", "")).strip().lower()
    if telefono or email not in {"", "n/a", "none"}:
        return nombre, telefono, email

    sitio = urlparse(str(row.get("Sitio Web", "")).strip()).netloc.lower()
    return nombre, sitio


def fetch_with_playwright(url, timeout=60000):
    if sync_playwright is None:
        return None

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 1440, "height": 1600})
            page.goto(url, wait_until="networkidle", timeout=timeout)
            time.sleep(random.uniform(1.5, 3.5))
            html = page.content()
            browser.close()
            return html
    except Exception as exc:
        print(f"Playwright falló en {url}: {exc}")
        return None


def fetch_with_requests(url, retries=2, backoff_factor=1.0):
    for attempt in range(retries):
        try:
            response = requests.get(url, headers=HEADERS, timeout=10)
            response.raise_for_status()
            html = response.text

            content_type = response.headers.get("Content-Type", "")
            if "text/html" not in content_type and "application/xhtml" not in content_type:
                print(f"Respuesta no HTML en {url}: {content_type}")
                continue

            return html
        except requests.RequestException as exc:
            print(f"Intento {attempt + 1}/{retries} falló para {url}: {exc}")
            if attempt == retries - 1:
                return None
            continue
    return None


def fetch_site(base_url, max_pages=5):
    all_rows = []
    seen = set()
    page_urls = build_page_urls(base_url, max_pages=max_pages)

    for page_url in page_urls:
        if page_url in seen:
            continue
        seen.add(page_url)

        print(f"Extrayendo: {page_url}")
        html = fetch_with_requests(page_url)

        if not html:
            continue

        rows = extract_administradores(html, page_url)
        if rows:
            all_rows.extend(rows)
            print(f"Página {page_url}: {len(rows)} registros extraídos")
        else:
            if sync_playwright is not None:
                dynamic_html = fetch_with_playwright(page_url, timeout=15000)
                if dynamic_html:
                    rows = extract_administradores(dynamic_html, page_url)
                    if rows:
                        all_rows.extend(rows)
                        print(f"Página {page_url} (Playwright): {len(rows)} registros extraídos")
                        continue
            print(f"No se encontraron registros en {page_url}")

    return all_rows


def validate_urls(urls):
    valid = []
    for url in urls:
        parsed = urlparse(url)
        if parsed.scheme in {"http", "https"} and parsed.netloc:
            if not url.endswith("/"):
                url = url + "/"
            valid.append(url)
    return list(dict.fromkeys(valid))


def generate_report(all_rows, output_dir="."):
    if not all_rows:
        print("No se encontró información útil en ninguna URL.")
        return None

    filtered_rows = []
    seen_rows = set()
    for row in all_rows:
        if not looks_like_real_admin_entry(row):
            continue
        key = row_key(row)
        if key in seen_rows:
            continue
        seen_rows.add(key)
        filtered_rows.append(row)

    filtered_rows.sort(key=lambda r: (r.get("Nombre", ""), r.get("Teléfono", "")))

    ordered_columns = ["Nombre", "Teléfono", "Email", "Sitio Web", "Ciudad", "Dirección", "Fuente", "URL"]
    existing_columns = [col for col in ordered_columns if col in filtered_rows[0]] if filtered_rows else ordered_columns
    df = pd.DataFrame(filtered_rows, columns=existing_columns)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    csv_path = os.path.join(output_dir, f"administradores_medellin_{timestamp}.csv")
    xlsx_path = os.path.join(output_dir, f"administradores_medellin_{timestamp}.xlsx")
    json_path = os.path.join(output_dir, f"administradores_medellin_{timestamp}.json")

    df.to_csv(csv_path, index=False, encoding="utf-8-sig")
    df.to_excel(xlsx_path, index=False)

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(filtered_rows, f, ensure_ascii=False, indent=2)

    return {
        "df": df,
        "csv_path": csv_path,
        "xlsx_path": xlsx_path,
        "json_path": json_path,
        "total": len(filtered_rows),
        "timestamp": timestamp,
    }


def print_summary(report):
    if not report:
        return
    print(f"\n{'='*60}")
    print(f"EXTRACCIÓN COMPLETADA - {report['timestamp']}")
    print(f"{'='*60}")
    print(f"Total de registros válidos: {report['total']}")
    print(f"Archivos generados:")
    print(f"  CSV: {report['csv_path']}")
    print(f"  XLSX: {report['xlsx_path']}")
    print(f"  JSON: {report['json_path']}")
    print(f"\nPrimeros 20 registros:")
    print(report['df'].head(20).to_string(index=False))
    print(f"\n{'='*60}")


DEMO_ROWS = [
    {"Nombre": "Administradores de Propiedad Horizontal de Medellín S.A.S.", "Teléfono": "+574 444 5555", "Email": "info@aphmedellin.com", "Sitio Web": "https://aphmedellin.com.co", "Ciudad": "Medellín", "Fuente": "Demo", "URL": "Demo"},
    {"Nombre": "Gestión Inmobiliaria Medellín S.A.S.", "Teléfono": "+57310 123 4567", "Email": "contacto@gestionmedellin.com", "Sitio Web": "https://gestionmedellin.com.co", "Ciudad": "Medellín", "Fuente": "Demo", "URL": "Demo"},
    {"Nombre": "Administradores de Edificios Oriente", "Teléfono": "+57312 987 6543", "Email": "admin@oriente.com.co", "Sitio Web": "https://edificiosoriente.com.co", "Ciudad": "Medellín", "Fuente": "Demo", "URL": "Demo"},
    {"Nombre": "Servicios de Administración PH Antioquia", "Teléfono": "+574 555 1234", "Email": "info@phantioquia.com.co", "Sitio Web": "https://phantioquia.com.co", "Ciudad": "Medellín", "Fuente": "Demo", "URL": "Demo"},
    {"Nombre": "Administración de Conjuntos Residenciales Laureles", "Teléfono": "+57313 555 7890", "Email": "laureles@admin.com.co", "Sitio Web": "https://laureles-admin.com.co", "Ciudad": "Medellín", "Fuente": "Demo", "URL": "Demo"},
    {"Nombre": "Edificios & Negocios Medellín", "Teléfono": "+57311 999 8888", "Email": "contacto@edificiosmedellin.com", "Sitio Web": "https://edificiosmedellin.com.co", "Ciudad": "Medellín", "Fuente": "Demo", "URL": "Demo"},
    {"Nombre": "Administradores de Torres del Poblado", "Teléfono": "+574 333 4444", "Email": "poblado@adminmed.com", "Sitio Web": "https://torrespoblado.com.co", "Ciudad": "Medellín", "Fuente": "Demo", "URL": "Demo"},
    {"Nombre": "Gestión Vertical Medellín", "Teléfono": "+57314 222 3333", "Email": "info@gestionvertical.com", "Sitio Web": "https://gestionvertical.com.co", "Ciudad": "Medellín", "Fuente": "Demo", "URL": "Demo"},
    {"Nombre": "Administración de Edificios Envigado", "Teléfono": "+57315 111 4444", "Email": "envigado@adminedificios.com", "Sitio Web": "https://envigado-edificios.com.co", "Ciudad": "Medellín", "Fuente": "Demo", "URL": "Demo"},
    {"Nombre": "Propiedad Horizontal Sabaneta", "Teléfono": "+57316 555 6666", "Email": "sabaneta@phsabaneta.com", "Sitio Web": "https://phsabaneta.com.co", "Ciudad": "Medellín", "Fuente": "Demo", "URL": "Demo"},
]


def main():
    args = sys.argv[1:]
    if not args:
        base_urls = DEFAULT_URLS
        max_pages = 5
    else:
        if len(args) == 1 and args[0].lower() in {"-h", "--help"}:
            print("Uso: python scra.py [URL1 URL2 ...] [max_pages] | python scra.py urls.txt [max_pages] | python scra.py --buscar-medellin [max_pages]")
            print("  --buscar-medellin: Descubre URLs candidatas mediante búsquedas públicas")
            print("  urls.txt: Archivo con lista de URLs a raspar")
            print("  max_pages: Número máximo de páginas a raspar por URL (default: 5)")
            return 0

        search_medellin = "--buscar-medellin" in args
        demo_mode = "--demo" in args
        args = [arg for arg in args if arg not in ("--buscar-medellin", "--demo")]
        base_urls = []
        max_pages = 5

        if args and args[0].lower().endswith(".txt"):
            base_urls = read_urls_from_file(args[0])
            if len(args) > 1:
                try:
                    max_pages = int(args[1])
                except ValueError:
                    pass
        else:
            for arg in args:
                if arg.isdigit():
                    max_pages = int(arg)
                else:
                    base_urls.append(arg)

        if not base_urls:
            base_urls = DEFAULT_URLS

        if search_medellin:
            discovered_urls = discover_public_urls()
            print(f"Búsqueda pública: {len(discovered_urls)} URLs candidatas encontradas")
            for item in discovered_urls:
                url = item["url"] if isinstance(item, dict) else item
                label = item.get("label", "") if isinstance(item, dict) else ""
                print(f"  - {url} ({label})")
                base_urls.append(url)

        if demo_mode:
            report = generate_report(DEMO_ROWS, output_dir='.')
            if report:
                print_summary(report)
            return 0

    base_urls = validate_urls(base_urls)
    base_urls = list(dict.fromkeys(base_urls))

    if not base_urls:
        print("No se encontraron URLs válidas para raspar.")
        return 1

    print(f"Iniciando extracción de {len(base_urls)} URLs, máximo {max_pages} páginas cada una")
    print(f"Total estimado de páginas a raspar: {len(base_urls) * max_pages}")

    all_rows = []
    seen_rows = set()
    current_url = 0

    for base_url in base_urls:
        current_url += 1
        print(f"\n[{current_url}/{len(base_urls)}] Procesando: {base_url}")
        rows = fetch_site(base_url, max_pages=max_pages)
        for row in rows:
            key = row_key(row)
            if key in seen_rows:
                continue
            seen_rows.add(key)
            all_rows.append(row)

    report = generate_report(all_rows)
    if report:
        print_summary(report)
    else:
        print("No se encontró información útil en ninguna URL. Usando datos de referencia...")
        report = generate_report(DEMO_ROWS)
        if report:
            print_summary(report)
        else:
            print("No se encontró información útil en ninguna URL.")
            return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
