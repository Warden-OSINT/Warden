-- Datos base de catálogos y la versión 1 de pesos del KRI (docs/scoring-model.md).

insert into public.risk_domains (key, name, description) values
  ('exposure',      'Exposición de servicios',  'Servicios y puertos visibles públicamente, según fuentes pasivas.'),
  ('email',         'Seguridad de correo',      'SPF, DKIM, DMARC y configuración MX publicada en DNS.'),
  ('certs',         'Certificados',             'Certificados TLS observados en logs de Certificate Transparency.'),
  ('secrets',       'Secretos filtrados',       'Credenciales o llaves expuestas en repositorios públicos.'),
  ('reputation',    'Reputación',               'Presencia de activos en listas de malware, phishing o botnets.'),
  ('impersonation', 'Suplantación',             'Dominios parecidos (typosquatting) registrados por terceros.');

-- Todas las fuentes arrancan deshabilitadas; un admin las habilita tras revisarlas.
-- Licencias en null están pendientes de verificar (docs/sources.md).
insert into public.sources (source_key, name, risk_domain_id, is_no_contact, license) values
  ('spiderfoot', 'SpiderFoot (módulos pasivos)', (select id from public.risk_domains where key = 'exposure'),      true,  'MIT'),
  -- InternetDB es gratuito solo para uso no comercial (docs/sources.md).
  ('internetdb', 'Shodan InternetDB',          (select id from public.risk_domains where key = 'exposure'),      true,  'Gratuito, uso no comercial'),
  ('crtsh',      'crt.sh',                       (select id from public.risk_domains where key = 'certs'),         true,  null),
  -- Lee SPF/DMARC/MX publicados vía dns.google (DoH); no contacta servidores de la empresa.
  ('email_dns',  'DNS público (correo)',         (select id from public.risk_domains where key = 'email'),         true,  'Registros DNS públicos'),
  ('checkdmarc', 'checkdmarc',                   (select id from public.risk_domains where key = 'email'),         true,  'Apache-2.0'),
  -- Clona repos públicos de github.com (organizaciones code_org confirmadas); no la infraestructura.
  ('gitleaks',   'Gitleaks',                     (select id from public.risk_domains where key = 'secrets'),       true,  'MIT'),
  -- URLhaus, ThreatFox y Feodo Tracker: API Community gratuita bajo uso justo (docs/sources.md).
  ('abusech',    'abuse.ch',                     (select id from public.risk_domains where key = 'reputation'),    true,  'API Community, uso justo'),
  -- Técnicas de dnstwist implementadas en Warden; solo consulta dns.google (DoH).
  ('typosquat',  'Dominios parecidos (DNS)',     (select id from public.risk_domains where key = 'impersonation'), true,  'Implementación propia'),
  -- Shodan es un servicio comercial, no open source: queda registrado pero bloqueado hasta decidirlo.
  ('shodan',     'Shodan',                       (select id from public.risk_domains where key = 'exposure'),      true,  'proprietary');

-- Solo el nombre de la variable de entorno del worker, nunca la llave.
insert into public.source_credentials (source_key, secret_ref) values
  ('abusech', 'ABUSECH_AUTH_KEY'),
  -- Opcional: respaldo Cert Spotter de crt.sh (sin llave, límite menor y solo para evaluación).
  ('crtsh', 'CERTSPOTTER_API_KEY');

-- Versión 1 de pesos, activa. Los pesos por dominio son los de la propuesta aprobada
-- (suman 100). SUPUESTO (pendiente de validar con el equipo): puntos por severidad y
-- factores por confianza, iguales en todos los dominios.
insert into public.scoring_weights (version, is_active) values (1, true);

insert into public.scoring_weight_items (weight_version_id, risk_domain_id, weight, severity_points, confidence_factors)
select
  (select id from public.scoring_weights where version = 1),
  d.id,
  w.weight,
  '{"critical": 40, "high": 20, "medium": 8, "low": 3, "info": 0}'::jsonb,
  '{"high": 1, "medium": 0.75, "low": 0.5}'::jsonb
from (values
  ('exposure', 25),
  ('email', 15),
  ('certs', 10),
  ('secrets', 20),
  ('reputation', 20),
  ('impersonation', 10)
) as w (key, weight)
join public.risk_domains d on d.key = w.key;
