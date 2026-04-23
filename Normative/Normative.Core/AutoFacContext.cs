using Autofac;
using System.Reflection;

namespace Normative.Core
{
    public class AutoFacContext
    {
        private AutoFacContext()
        {
        }

        private static AutoFacContext instance;

        public static AutoFacContext Instance
        {
            get
            {
                if (instance == null)
                {
                    instance = new AutoFacContext();
                }

                return instance;
            }
        }

        private IContainer handleProvider;

        public IContainer HandleProvider
        {
            get
            {
                if (handleProvider == null)
                {
                    var builder = new ContainerBuilder();
                    var assembly = Assembly.GetAssembly(typeof(AutoFacContext));
                    if (assembly != null)
                    {
                        foreach (var type in assembly.GetTypes())
                        {
                            if (type.IsClass && type.IsSubclassOf(typeof(DocHandleBase)))
                            {
                                foreach (var customAttribute in type.GetCustomAttributes(typeof(DocTypeAttribute), false))
                                {
                                    if (customAttribute is DocTypeAttribute fatt)
                                    {
                                        if (fatt != null)
                                        {
                                            var atts = fatt.AttriNames;
                                            foreach (var a in atts)
                                            {
                                                builder.RegisterType(type).Named(a, type);
                                                builder.RegisterType(type).Named<DocHandleBase>(a).As(typeof(DocHandleBase)).AsSelf().InstancePerDependency();
                                            }
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    handleProvider = builder.Build();
                }
                return handleProvider;
            }
        }




    }
}
