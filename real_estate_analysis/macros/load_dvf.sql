/*
    Charge les fichiers DVF géolocalisés (data.gouv.fr) dans la table source main.dvf.

    Appelée automatiquement en on-run-start (dbt_project.yml) : ne télécharge que si
    main.dvf n'existe pas encore. Périmètre via les vars dvf_departements / dvf_years.

    Usage :
        dbt build                                   -- charge si la table est absente
        dbt build --vars '{dvf_reload: true}'       -- force le rechargement
        dbt build --vars '{dvf_reload: true, dvf_departements: ["59", "62"], dvf_years: [2022, 2023]}'
        dbt run-operation load_dvf --args '{force: true}'

    Années disponibles : 2021 à 2025. La Corse se code "2A" / "2B".
    La table est recréée à chaque chargement : pas de doublons.
*/

{% macro load_dvf(departements=none, years=none, force=false) %}

    {% if not execute %}
        {{ return("") }}
    {% endif %}

    {% set departements = departements or var("dvf_departements", ["59"]) %}
    {% set years = years or var("dvf_years", [2022, 2023]) %}
    {% set force = force or var("dvf_reload", false) %}

    {% set existing = adapter.get_relation(database=target.database, schema="main", identifier="dvf") %}
    {% if existing and not force %}
        {{ log("main.dvf déjà présente : chargement ignoré (--vars '{dvf_reload: true}' pour recharger)", info=true) }}
        {{ return("") }}
    {% endif %}

    {% set base_url = "https://files.data.gouv.fr/geo-dvf/latest/csv" %}

    {% set urls = [] %}
    {% for year in years %}
        {% for dep in departements %}
            {% set dep = dep | string %}
            {% set dep = "0" ~ dep if dep | length == 1 else dep %}
            {% do urls.append("'" ~ base_url ~ "/" ~ year ~ "/departements/" ~ dep ~ ".csv.gz'") %}
        {% endfor %}
    {% endfor %}

    {% set sql %}
        install httpfs;
        load httpfs;

        create or replace table main.dvf as
        select * from read_csv(
            [{{ urls | join(", ") }}],
            union_by_name = true,
            -- codes en texte pour conserver les zéros en tête (ex. 01000)
            types = {
                'code_postal': 'VARCHAR',
                'code_commune': 'VARCHAR',
                'code_departement': 'VARCHAR',
                'id_parcelle': 'VARCHAR',
                'ancien_id_parcelle': 'VARCHAR',
                'ancien_code_commune': 'VARCHAR',
                'adresse_code_voie': 'VARCHAR',
                'code_type_local': 'VARCHAR'
            }
        );
    {% endset %}

    {{ log("Chargement de " ~ urls | length ~ " fichier(s) DVF...", info=true) }}
    {% do run_query(sql) %}

    {% set count = run_query("select count(*) from main.dvf").columns[0].values()[0] %}
    {{ log("main.dvf chargée : " ~ count ~ " lignes", info=true) }}

    {{ return("") }}

{% endmacro %}
