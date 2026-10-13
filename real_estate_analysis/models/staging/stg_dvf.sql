with source as (
    select * from {{ source('dvf', 'dvf') }}
),

renamed as (
    select
        -- identifiants
        id_mutation,
        numero_disposition,
        id_parcelle,
        ancien_id_parcelle,

        -- dates
        date_mutation,
        year(date_mutation)  as annee_mutation,
        month(date_mutation) as mois_mutation,

        -- mutation
        nature_mutation,
        valeur_fonciere,

        -- adresse
        adresse_numero,
        adresse_suffixe,
        adresse_nom_voie,
        adresse_code_voie,
        code_postal,

        -- localisation
        code_commune,
        nom_commune,
        code_departement,
        ancien_code_commune,
        ancien_nom_commune,
        longitude,
        latitude,

        -- lots
        numero_volume,
        lot1_numero,
        lot1_surface_carrez,
        lot2_numero,
        lot2_surface_carrez,
        lot3_numero,
        lot3_surface_carrez,
        lot4_numero,
        lot4_surface_carrez,
        lot5_numero,
        lot5_surface_carrez,
        nombre_lots,

        -- bien
        code_type_local,
        type_local,
        surface_reelle_bati,
        nombre_pieces_principales,

        -- terrain
        code_nature_culture,
        nature_culture,
        code_nature_culture_speciale,
        nature_culture_speciale,
        surface_terrain

    from source
)

select * from renamed