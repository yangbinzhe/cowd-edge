//! Edge-owned platform adapter host.
//!
//! Platform SDK integration is an external Edge concern, not an AI harness
//! runtime concern. Gateway invokes managed adapters through authenticated
//! HTTP/2 over a private Unix-domain socket and never links their SDK dependencies.

pub mod mirror;

pub mod cowd_dirs;

pub mod driver_profiles {
    include!("driver_profiles_generated.rs");
}

pub mod managed_server;
pub mod message_sidecar;
pub mod platform;
#[cfg(feature = "source-db")]
mod source_db;
pub mod source_sidecar;

#[cfg(test)]
mod driver_profile_tests {
    use std::collections::BTreeSet;
    use std::path::Path;

    use edge_contract::{SurfaceManifest, SurfaceRuntimeSpec, SurfaceTransport};

    #[test]
    fn driver_profile_matrix_has_nine_logical_instances_and_six_artifacts() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(Path::parent)
            .unwrap();
        let registry: serde_json::Value = serde_json::from_slice(
            &std::fs::read(root.join("contracts/driver-profiles.json")).unwrap(),
        )
        .unwrap();
        let rows = registry["profiles"].as_array().unwrap();
        assert_eq!(rows.len(), 9);
        assert_eq!(crate::driver_profiles::DRIVER_PROFILES.len(), 9);

        let mut artifacts = BTreeSet::new();
        for row in rows {
            let id = row["id"].as_str().unwrap();
            let relative = row["path"].as_str().unwrap();
            let manifest: SurfaceManifest =
                serde_json::from_slice(&std::fs::read(root.join(relative)).unwrap()).unwrap();
            manifest.validate().unwrap();
            let generated = crate::driver_profiles::driver_profile(id).unwrap();
            assert_eq!(manifest.id, generated.surface_id);
            match manifest.runtime.as_ref().unwrap() {
                SurfaceRuntimeSpec::Managed {
                    artifact,
                    driver_profile,
                    transport,
                } => {
                    assert_eq!(artifact, generated.artifact);
                    assert_eq!(driver_profile, generated.id);
                    assert_eq!(*transport, SurfaceTransport::UdsHttp2);
                    artifacts.insert(artifact.clone());
                }
                SurfaceRuntimeSpec::OneShot { .. } => panic!("managed profile became one-shot"),
            }
        }
        assert_eq!(artifacts.len(), 6, "artifacts={artifacts:?}");
    }
}
