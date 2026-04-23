using System;
using System.Configuration;
using System.Reflection;
using System.Security.Cryptography.X509Certificates;
using System.ServiceModel;
using System.ServiceModel.Channels;
using System.ServiceModel.Configuration;
using System.ServiceModel.Description;

namespace Normative.Client
{
    public class CustomClientChannel<T> : ChannelFactory<T>
    {
        private string configurationPath;

        private string endpointConfigurationName;

        public CustomClientChannel(string configurationPath)
            : base(typeof(T))
        {
            this.configurationPath = configurationPath;
            this.InitializeEndpoint((string)null, null);
        }

        public CustomClientChannel(Binding binding, EndpointAddress endpointAddress, string configurationPath)
            : base(typeof(T))
        {
            this.configurationPath = configurationPath;
            this.InitializeEndpoint(binding, endpointAddress);
        }

        public CustomClientChannel(ServiceEndpoint serviceEndpoint, string configurationPath)
            : base(typeof(T))
        {
            this.configurationPath = configurationPath;
            this.InitializeEndpoint(serviceEndpoint);
        }

        public CustomClientChannel(
            string endpointConfigurationName,
            EndpointAddress endpointAddress,
            string configurationPath)
            : base(typeof(T))
        {
            this.configurationPath = configurationPath;
            this.endpointConfigurationName = endpointConfigurationName;
            this.InitializeEndpoint(endpointConfigurationName, endpointAddress);
        }

        public CustomClientChannel(Binding binding, string configurationPath)
            : this(binding, (EndpointAddress)null, configurationPath)
        {
        }

        public CustomClientChannel(string endpointConfigurationName, string configurationPath)
            : this(endpointConfigurationName, null, configurationPath)
        {
        }

        public CustomClientChannel(Binding binding, string remoteAddress, string configurationPath)
            : this(binding, new EndpointAddress(remoteAddress), configurationPath)
        {
        }

        protected override ServiceEndpoint CreateDescription()
        {
            var serviceEndpoint = base.CreateDescription();

            if (!string.IsNullOrEmpty(this.endpointConfigurationName))
            {
                serviceEndpoint.Name = this.endpointConfigurationName;
            }

            var map = new ExeConfigurationFileMap { ExeConfigFilename = this.configurationPath };
            var config = ConfigurationManager.OpenMappedExeConfiguration(map, ConfigurationUserLevel.None);
            var group = ServiceModelSectionGroup.GetSectionGroup(config);
            ChannelEndpointElement selectedEndpoint = null;

            foreach (ChannelEndpointElement endpoint in group.Client.Endpoints)
            {
                if (endpoint.Contract == serviceEndpoint.Contract.ConfigurationName
                    && (string.IsNullOrEmpty(this.endpointConfigurationName)
                        || this.endpointConfigurationName == endpoint.Name))
                {
                    selectedEndpoint = endpoint;

                    break;
                }
            }

            if (selectedEndpoint != null)
            {
                if (serviceEndpoint.Binding == null)
                {
                    serviceEndpoint.Binding = this.CreateBinding(selectedEndpoint.Binding, group);
                }

                if (serviceEndpoint.Address == null)
                {
                    serviceEndpoint.Address = new EndpointAddress(
                        selectedEndpoint.Address,
                        this.GetIdentity(selectedEndpoint.Identity),
                        selectedEndpoint.Headers.Headers);
                }

                if (serviceEndpoint.Behaviors.Count == 0 && selectedEndpoint.BehaviorConfiguration != null)
                {
                    this.AddBehaviors(selectedEndpoint.BehaviorConfiguration, serviceEndpoint, group);
                }

                serviceEndpoint.Name = selectedEndpoint.Contract;
            }

            return serviceEndpoint;
        }

        private void AddBehaviors(
            string behaviorConfiguration,
            ServiceEndpoint serviceEndpoint,
            ServiceModelSectionGroup group)
        {
            var behaviorElement = group.Behaviors.EndpointBehaviors[behaviorConfiguration];

            foreach (var behaviorExtension in behaviorElement)
            {
                var extension = behaviorExtension.GetType().InvokeMember(
                    "CreateBehavior",
                    BindingFlags.InvokeMethod | BindingFlags.NonPublic | BindingFlags.Instance,
                    null,
                    behaviorExtension,
                    null);

                if (extension != null)
                {
                    serviceEndpoint.Behaviors.Add((IEndpointBehavior)extension);
                }
            }
        }

        private Binding CreateBinding(string bindingName, ServiceModelSectionGroup group)
        {
            var bindingElementCollection = group.Bindings[bindingName];

            if (bindingElementCollection.ConfiguredBindings.Count == 0)
            {
                return null;
            }

            var be = bindingElementCollection.ConfiguredBindings[0];
            var binding = this.GetBinding(be);

            if (be != null)
            {
                be.ApplyConfiguration(binding);
            }

            return binding;
        }

        private Binding GetBinding(IBindingConfigurationElement configurationElement)
        {
            if (configurationElement is CustomBindingElement)
            {
                return new CustomBinding();
            }
            else if (configurationElement is BasicHttpBindingElement)
            {
                return new BasicHttpBinding();
            }
            else if (configurationElement is NetMsmqBindingElement)
            {
                return new NetMsmqBinding();
            }
            else if (configurationElement is NetNamedPipeBindingElement)
            {
                return new NetNamedPipeBinding();
            }
            else if (configurationElement is NetPeerTcpBindingElement)
            {
                return new NetPeerTcpBinding();
            }
            else if (configurationElement is NetTcpBindingElement)
            {
                return new NetTcpBinding();
            }
            else if (configurationElement is WSDualHttpBindingElement)
            {
                return new WSDualHttpBinding();
            }
            else if (configurationElement is WSHttpBindingElement)
            {
                return new WSHttpBinding();
            }
            else if (configurationElement is WSFederationHttpBindingElement)
            {
                return new WSFederationHttpBinding();
            }
            else
            {
                return null;
            }
        }

        private EndpointIdentity GetIdentity(IdentityElement element)
        {
            var properties = element.ElementInformation.Properties;

            if (properties["userPrincipalName"].ValueOrigin != PropertyValueOrigin.Default)
            {
                return EndpointIdentity.CreateUpnIdentity(element.UserPrincipalName.Value);
            }

            if (properties["servicePrincipalName"].ValueOrigin != PropertyValueOrigin.Default)
            {
                return EndpointIdentity.CreateSpnIdentity(element.ServicePrincipalName.Value);
            }

            if (properties["dns"].ValueOrigin != PropertyValueOrigin.Default)
            {
                return EndpointIdentity.CreateDnsIdentity(element.Dns.Value);
            }

            if (properties["rsa"].ValueOrigin != PropertyValueOrigin.Default)
            {
                return EndpointIdentity.CreateRsaIdentity(element.Rsa.Value);
            }

            if (properties["certificate"].ValueOrigin != PropertyValueOrigin.Default)
            {
                var supportingCertificates = new X509Certificate2Collection();
                supportingCertificates.Import(Convert.FromBase64String(element.Certificate.EncodedValue));

                if (supportingCertificates.Count == 0)
                {
                    throw new InvalidOperationException("UnableToLoadCertificateIdentity");
                }

                var primaryCertificate = supportingCertificates[0];
                supportingCertificates.RemoveAt(0);

                return EndpointIdentity.CreateX509CertificateIdentity(primaryCertificate, supportingCertificates);
            }

            return null;
        }
    }
}
