// *** WARNING: this file was generated by crd2pulumi. ***
// *** Do not edit by hand unless you're certain you know what you are doing! ***

import * as pulumi from "@pulumi/pulumi";
import * as inputs from "../../types/input";
import * as outputs from "../../types/output";
import * as utilities from "../../utilities";

import {ObjectMeta} from "../../meta/v1";

/**
 * A Certificate resource should be created to ensure an up to date and signed x509 certificate is stored in the Kubernetes Secret resource named in `spec.secretName`.
 *  The stored certificate will be renewed before it expires (as configured by `spec.renewBefore`).
 */
export class Certificate extends pulumi.CustomResource {
    /**
     * Get an existing Certificate resource's state with the given name, ID, and optional extra
     * properties used to qualify the lookup.
     *
     * @param name The _unique_ name of the resulting resource.
     * @param id The _unique_ provider ID of the resource to lookup.
     * @param opts Optional settings to control the behavior of the CustomResource.
     */
    public static get(name: string, id: pulumi.Input<pulumi.ID>, opts?: pulumi.CustomResourceOptions): Certificate {
        return new Certificate(name, undefined as any, { ...opts, id: id });
    }

    /** @internal */
    public static readonly __pulumiType = 'kubernetes:cert-manager.io/v1beta1:Certificate';

    /**
     * Returns true if the given object is an instance of Certificate.  This is designed to work even
     * when multiple copies of the Pulumi SDK have been loaded into the same process.
     */
    public static isInstance(obj: any): obj is Certificate {
        if (obj === undefined || obj === null) {
            return false;
        }
        return obj['__pulumiType'] === Certificate.__pulumiType;
    }

    public readonly apiVersion!: pulumi.Output<"cert-manager.io/v1beta1" | undefined>;
    public readonly kind!: pulumi.Output<"Certificate" | undefined>;
    public readonly metadata!: pulumi.Output<ObjectMeta | undefined>;
    /**
     * Desired state of the Certificate resource.
     */
    public readonly spec!: pulumi.Output<outputs.certmanager.v1beta1.CertificateSpec>;
    /**
     * Status of the Certificate. This is set and managed automatically.
     */
    public readonly status!: pulumi.Output<outputs.certmanager.v1beta1.CertificateStatus | undefined>;

    /**
     * Create a Certificate resource with the given unique name, arguments, and options.
     *
     * @param name The _unique_ name of the resource.
     * @param args The arguments to use to populate this resource's properties.
     * @param opts A bag of options that control this resource's behavior.
     */
    constructor(name: string, args?: CertificateArgs, opts?: pulumi.CustomResourceOptions) {
        let inputs: pulumi.Inputs = {};
        if (!(opts && opts.id)) {
            inputs["apiVersion"] = "cert-manager.io/v1beta1";
            inputs["kind"] = "Certificate";
            inputs["metadata"] = args ? args.metadata : undefined;
            inputs["spec"] = args ? args.spec : undefined;
            inputs["status"] = args ? args.status : undefined;
        } else {
            inputs["apiVersion"] = undefined /*out*/;
            inputs["kind"] = undefined /*out*/;
            inputs["metadata"] = undefined /*out*/;
            inputs["spec"] = undefined /*out*/;
            inputs["status"] = undefined /*out*/;
        }
        if (!opts) {
            opts = {}
        }

        if (!opts.version) {
            opts.version = utilities.getVersion();
        }
        super(Certificate.__pulumiType, name, inputs, opts);
    }
}

/**
 * The set of arguments for constructing a Certificate resource.
 */
export interface CertificateArgs {
    readonly apiVersion?: pulumi.Input<"cert-manager.io/v1beta1">;
    readonly kind?: pulumi.Input<"Certificate">;
    readonly metadata?: pulumi.Input<ObjectMeta>;
    /**
     * Desired state of the Certificate resource.
     */
    readonly spec?: pulumi.Input<inputs.certmanager.v1beta1.CertificateSpec>;
    /**
     * Status of the Certificate. This is set and managed automatically.
     */
    readonly status?: pulumi.Input<inputs.certmanager.v1beta1.CertificateStatus>;
}
