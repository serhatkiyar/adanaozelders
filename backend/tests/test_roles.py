from models.role import ROLE_IDS, ROLE_NAMES, RoleType, role_name


def test_role_name_maps_ids_to_strings():
    assert role_name(ROLE_IDS[RoleType.ADMIN]) == "ADMIN"
    assert role_name(ROLE_IDS[RoleType.TUTOR]) == "TUTOR"
    assert role_name(ROLE_IDS[RoleType.CLIENT]) == "CLIENT"


def test_role_names_is_inverse_of_role_ids():
    for role, rid in ROLE_IDS.items():
        assert ROLE_NAMES[rid] == role
